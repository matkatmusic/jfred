// CLI (docker container only): node engineV3_replay.mjs --git-repo <path> --state <folder> --jsonl <folder> [--jsonl <folder> ...]

import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { readReplaySettingsFromArguments, type ReplaySettings } from "./engineV3_replay_settings.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
// import { applyCommitToState, applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { compareStateToHead } from "./engineV3_replay_check.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
// import { copyRepoIntoState,moveBranchesToCommitTime } from "./engineV3_replay_git.ts";
import { createStartRepo } from "./engineV3_replay_git_start.ts";
import { writeUntrackedStartFiles } from "./engineV3_replay_start_files.ts";
import { applyOutsideGitRow } from "./engineV3_replay_outside_git.ts";
import { executePlateRun } from "./engineV3_replay_plate_run.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";
import { writeTouchedPathsFile } from "./engineV3_replay_touched.ts";

const DOCKER_MARKER_FILE = "/.dockerenv";

export function doSomethingWithEvent(state: Path, event: TimelineEvent, repoPath: Path, jsonlsPaths: Path[], fileSnapshots: Path[], context: ScriptReplayContext): Path {
  if (event.type === TimelineEventKind.GitCommit) {
    // applyCommitToState(event.commit, state, repoPath);
    // moveBranchesToCommitTime(state, repoPath, event.commit);
    // return state;
    throw new Error("doSomethingWithEvent: commit events are turned off");
  }
  if (event.type === TimelineEventKind.OutsideGitAction) {
    applyOutsideGitRow(state, repoPath, event.row);
    return state;
  }
  if (event.type === TimelineEventKind.PlateCapture) {
    if (context.jotPath === undefined) {
      throw new Error("doSomethingWithEvent: a plate capture event needs the --jot folder in the context");
    }
    executePlateRun(event.capture, context.jotPath);
    return state;
  }
  return applyJSONLLineToState(state, event.line, fileSnapshots, context);
}

export function formatEventText(event: TimelineEvent, repoPath: Path): string {
  if (event.type === TimelineEventKind.GitCommit) {
    return `${new Date().toISOString()} next event: source:${repoPath.toString()} commit:${event.commit.toString()}`;
  }
  if (event.type === TimelineEventKind.OutsideGitAction) {
    return `${new Date().toISOString()} next event: outside git: ${event.row.kind} ${event.row.newCommit} ${event.row.message}`;
  }
  if (event.type === TimelineEventKind.PlateCapture) {
    return `${new Date().toISOString()} next event: plate capture: ${basename(event.capture.captureFile.toString())} ${event.capture.eventName} ${event.capture.cwd.toString()}`;
  }
  const source = getRecordSource(event.line);
  if (source === undefined) {
    throw new Error("formatEventText: the JSONL line has no source file");
  }
  return `${new Date().toISOString()} next event: source:${source.filePath} line:${source.lineNumber}`;
}

export function executeReplay(state: Path, repoPath: Path, jsonlsPaths: Path[], fileSnapshots: Path[], context: ScriptReplayContext): Path {
  let lastEvent: TimelineEvent | null = null;
  while (true) {
    const event = getNextEvent(repoPath, jsonlsPaths, lastEvent, context.macPlatePath);
    if (event === TERMINAL_EVENT) {
      break;
    }
    console.log(formatEventText(event, repoPath));
    state = doSomethingWithEvent(state, event, repoPath, jsonlsPaths, fileSnapshots, context);
    lastEvent = event;
  }
  return state;
}

// The state folder is a real repo path: run only in the container, on an empty folder.
function assertSafeToReplay(state: Path): void {
  const stateText = state.toString();
  const isInContainer = existsSync(DOCKER_MARKER_FILE);
  if (isInContainer === false) {
    throw new Error(`refusing to run: ${DOCKER_MARKER_FILE} does not exist, so this is not a docker container`);
  }
  const stateExists = existsSync(stateText);
  if (stateExists === false) {
    throw new Error(`refusing to run: the state folder ${stateText} does not exist`);
  }
  const stateEntries = readdirSync(stateText);
  const isEmpty = stateEntries.length === 0;
  if (isEmpty === false) {
    throw new Error(`refusing to run: the state folder ${stateText} is not empty`);
  }
}

function createScriptReplayContext(settings: ReplaySettings): ScriptReplayContext {
  const jsonlPathTexts: string[] = [];
  for (const jsonlPath of settings.jsonlsPaths) {
    jsonlPathTexts.push(jsonlPath.toString());
  }
  const jsonlLines = loadMergedJSONLLines(jsonlPathTexts).jsonlLines;
  const bashCallResults = collectBashCallResults(jsonlLines);
  const writeEditResultLines = collectWriteEditResultLines(jsonlLines);
  return { bashCallResults, writeEditResultLines, sourceRepo: settings.repoPath, macPlatePath: settings.macPlatePath, jotPath: settings.jotPath };
}

const isCliRun =process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const settings = readReplaySettingsFromArguments(process.argv.slice(2));
  assertSafeToReplay(settings.state);
  // copyRepoIntoState(settings.repoPath, settings.state);
  createStartRepo(settings.repoPath, settings.state);
  writeUntrackedStartFiles(settings.state);
  const context = createScriptReplayContext(settings);
  executeReplay(settings.state, settings.repoPath, settings.jsonlsPaths, [], context);
  for (const line of compareStateToHead(settings.state, settings.repoPath)) {
    console.log(line);
  }
  writeTouchedPathsFile(settings.state, settings.touchedOutput);
}
