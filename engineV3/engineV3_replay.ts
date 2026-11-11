// CLI (docker container only): node engineV3_replay.mjs --git-repo <path> --state <folder> --jsonl <folder> [--jsonl <folder> ...]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { readReplaySettingsFromArguments, type ReplaySettings } from "./engineV3_replay_settings.ts";
import { TimelineEventKind, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
// import { applyCommitToState, applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
// import { getFirstLineTime, loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { getFirstLineTime } from "./engineV3_jsonl_lines.ts";
import { loadJSONLLineIndex, readFullJSONLLine, readFullResultLines } from "./engineV3_jsonl_line_index.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectResultTurnSnapshotIds, collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { collectEarlierSiblingMessageIds, collectForkedMessageIds } from "./engineV3_replay_backups.ts";
import { compareStateToHead } from "./engineV3_replay_check.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
// import { copyRepoIntoState,moveBranchesToCommitTime } from "./engineV3_replay_git.ts";
// import { createStartRepo } from "./engineV3_replay_git_start.ts";
// import { writeUntrackedStartFiles } from "./engineV3_replay_start_files.ts";
import { createStartState, getRequiredSourceRepo } from "./engineV3_replay_no_git.ts";
import { applyOutsideGitRow } from "./engineV3_replay_outside_git.ts";
import { executePlateRun } from "./engineV3_replay_plate_run.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";
import { writeTouchedPathsFile } from "./engineV3_replay_touched.ts";
import { createSnapshotLoopIfRequested, writeSnapshotAfterEvent, type SnapshotLoop } from "./engineV3_replay_snapshot_loop.ts";
import { runStartupPhase } from "./engineV3_startup_progress.ts";
import { createSessionScratchpadFolder, MAC_CLAUDE_TEMP_FOLDER } from "./engineV3_replay_scratchpad.ts";

const DOCKER_MARKER_FILE = "/.dockerenv";

export function doSomethingWithEvent(state: Path, event: TimelineEvent, repoPath: Path | undefined,jsonlsPaths: Path[], fileSnapshots: Path[], context: ScriptReplayContext): Path {
  if (event.type === TimelineEventKind.GitCommit) {
    // applyCommitToState(event.commit, state, repoPath);
    // moveBranchesToCommitTime(state, repoPath, event.commit);
    // return state;
    throw new Error("doSomethingWithEvent: commit events are turned off");
  }
  if (event.type === TimelineEventKind.OutsideGitAction) {
    applyOutsideGitRow(state, getRequiredSourceRepo(repoPath), event.row);
    return state;
  }
  if (event.type === TimelineEventKind.PlateCapture) {
    if (context.jotPath === undefined) {
      throw new Error("doSomethingWithEvent: a plate capture event needs the --jot folder in the context");
    }
    executePlateRun(event.capture, context.jotPath);
    return state;
  }
  if (context.claudeTempFolder !== undefined) {
    createSessionScratchpadFolder(context.claudeTempFolder, event.line);
  }
  return applyJSONLLineToState(state, event.line, fileSnapshots, context);
}

export function formatEventText(event: TimelineEvent, repoPath: Path | undefined): string {
  if (event.type === TimelineEventKind.GitCommit) {
    return `${new Date().toISOString()} next event: source:${repoPath?.toString()} commit:${event.commit.toString()}`;
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

function writeNextLineFileAndStop(source: RecordSource, nextLineFile: Path): never {
  const rawLine = readFileSync(source.filePath, "utf8").split("\n")[source.lineNumber - 1]!;
  writeFileSync(nextLineFile.toString(), JSON.stringify(JSON.parse(rawLine), null, 2));
  const stoppedText = `stopped before ${source.filePath}:${source.lineNumber}`;
  console.log(stoppedText);
  throw new Error(`executeReplay: ${stoppedText}`);
}

function logEventThenStopIfBeforeLine(event: TimelineEvent, eventText: string, stopBefore: { line: RecordSource; nextLineFile: Path } | undefined): void {
  console.log(eventText);
  if (stopBefore !== undefined) {
    if (event.type === TimelineEventKind.JSONLLine) {
      const source = getRecordSource(event.line);
      if (source !== undefined) {
        if (source.filePath === stopBefore.line.filePath) {
          if (source.lineNumber === stopBefore.line.lineNumber) {
            writeNextLineFileAndStop(source, stopBefore.nextLineFile);
          }
        }
      }
    }
  }
}

// The timeline holds index lines; the full line is read from disk only for the event being replayed.
function readFullLineOfEvent(event: TimelineEvent): TimelineEvent {
  if (event.type === TimelineEventKind.JSONLLine) {
    return { ...event, line: readFullJSONLLine(event.line) };
  }
  return event;
}

export function executeReplay(state: Path, repoPath: Path | undefined,jsonlsPaths: Path[], fileSnapshots: Path[], context: ScriptReplayContext, snapshotLoop?: SnapshotLoop, stopBefore?: { line: RecordSource; nextLineFile: Path }): Path {
  let lastEvent: TimelineEvent | null = null;
  while (true) {
    const event = getNextEvent(repoPath, jsonlsPaths, lastEvent, context.macPlatePath);
    if (event === TERMINAL_EVENT) {
      break;
    }
    const replayedEvent = readFullLineOfEvent(event);
    const eventText = formatEventText(replayedEvent, repoPath);
    logEventThenStopIfBeforeLine(replayedEvent, eventText, stopBefore);
    state = doSomethingWithEvent(state, replayedEvent, repoPath, jsonlsPaths, fileSnapshots, context);
    writeSnapshotAfterEvent(snapshotLoop, replayedEvent, eventText, state, context.writeEditResultLines);
    // getNextEvent finds its place by the timeline's own event object.
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

export function loadReplayJSONLLines(settings: ReplaySettings): JSONLLine[] {
  const jsonlPathTexts: string[] = [];
  for (const jsonlPath of settings.jsonlsPaths) {
    jsonlPathTexts.push(jsonlPath.toString());
  }
  // const mergedLines = runStartupPhase("JSONL load", (reportProgress) => loadMergedJSONLLines(jsonlPathTexts, reportProgress), (loaded) => `loaded ${loaded.transcriptFileCount} JSONL files, ${loaded.jsonlLines.length} lines`);
  // return mergedLines.jsonlLines;
  const lineIndex = runStartupPhase("JSONL load", (reportProgress) => loadJSONLLineIndex(jsonlPathTexts, reportProgress), (loaded) => `loaded ${loaded.transcriptFileCount} JSONL files, ${loaded.indexLines.length} lines`);
  return lineIndex.indexLines;
}

function describeCollectStep(stepName: string): (entries: Map<string, unknown> | Set<string>) => string {
  return (entries) => `${stepName} returned ${entries.size} entries`;
}

export function createScriptReplayContext(settings: ReplaySettings, jsonlLines: JSONLLine[]): ScriptReplayContext {
  const bashCallResults = runStartupPhase("collectBashCallResults", () => collectBashCallResults(jsonlLines), describeCollectStep("collectBashCallResults"));
  // const writeEditResultLines = runStartupPhase("collectWriteEditResultLines", () => collectWriteEditResultLines(jsonlLines), describeCollectStep("collectWriteEditResultLines"));
  const writeEditResultLines = runStartupPhase("collectWriteEditResultLines", () => readFullResultLines(collectWriteEditResultLines(jsonlLines)), describeCollectStep("collectWriteEditResultLines"));
  const forkedMessageIds = runStartupPhase("collectForkedMessageIds", () => collectForkedMessageIds(jsonlLines), describeCollectStep("collectForkedMessageIds"));
  const earlierSiblingMessageIds = runStartupPhase("collectEarlierSiblingMessageIds", () => collectEarlierSiblingMessageIds(jsonlLines), describeCollectStep("collectEarlierSiblingMessageIds"));
  const resultTurnSnapshotIds = runStartupPhase("collectResultTurnSnapshotIds", () => collectResultTurnSnapshotIds(jsonlLines, writeEditResultLines), describeCollectStep("collectResultTurnSnapshotIds"));
  // return { bashCallResults, writeEditResultLines, resultTurnSnapshotIds, sourceRepo: settings.repoPath, macPlatePath: settings.macPlatePath, jotPath: settings.jotPath, fileHistoryPath: settings.fileHistoryPath, forkedMessageIds, earlierSiblingMessageIds };
  return { bashCallResults, writeEditResultLines, resultTurnSnapshotIds, sourceRepo: settings.repoPath, macPlatePath: settings.macPlatePath, jotPath: settings.jotPath, fileHistoryPath: settings.fileHistoryPath, forkedMessageIds, earlierSiblingMessageIds, claudeTempFolder: MAC_CLAUDE_TEMP_FOLDER };
}

const isCliRun =process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const settings = readReplaySettingsFromArguments(process.argv.slice(2));
  assertSafeToReplay(settings.state);
  // copyRepoIntoState(settings.repoPath, settings.state);
  // createStartRepo(settings.repoPath, settings.state);
  // writeUntrackedStartFiles(settings.state);
  const jsonlLines = loadReplayJSONLLines(settings);
  runStartupPhase("createStartState", () => createStartState(settings.repoPath, settings.startFilesPath, settings.state, getFirstLineTime(jsonlLines), settings.writePlaygroundStartFiles), () => "created the start state");
  const snapshotLoop = runStartupPhase("snapshot loop start", () => createSnapshotLoopIfRequested(settings.snapshotsPath, settings.state, settings.watchPaths), (loop) => (loop === undefined ? "no snapshot loop" : "started the snapshot loop"));
  const context = createScriptReplayContext(settings, jsonlLines);
  const stopBefore = settings.stopBefore === undefined ? undefined : { line: settings.stopBefore, nextLineFile: new Path("/tmp/next-line.json") };
  executeReplay(settings.state, settings.repoPath, settings.jsonlsPaths, [], context, snapshotLoop, stopBefore);
  if (settings.repoPath !== undefined) {
    for (const line of compareStateToHead(settings.state, settings.repoPath)) {
      console.log(line);
    }
  }
  writeTouchedPathsFile(settings.state, settings.touchedOutput);
}
