// CLI (docker container only): node engineV3_replay.mjs --git-repo <path> --state <folder> --jsonl <folder> [--jsonl <folder> ...]

import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { applyCommitToState, applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { compareStateToHead } from "./engineV3_replay_check.ts";
import { copyRepoIntoState,moveBranchesToCommitTime } from "./engineV3_replay_git.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";
import { writeTouchedPathsFile } from "./engineV3_replay_touched.ts";

type ReplaySettings = { repoPath: Path; state: Path; jsonlsPaths: Path[]; touchedOutput: Path };

const DOCKER_MARKER_FILE = "/.dockerenv";
const JSONL_FLAG = "--jsonl";
const USAGE = "usage: node engineV3_replay.mjs --git-repo <path> --state <folder> --touched-out <file> --jsonl <folder> [--jsonl <folder> ...]";

export function doSomethingWithEvent(state: Path, event: TimelineEvent, repoPath: Path, jsonlsPaths: Path[], fileSnapshots: Path[]): Path {
  if (event.type === TimelineEventKind.GitCommit) {
    applyCommitToState(event.commit, state, repoPath);
    moveBranchesToCommitTime(state, repoPath, event.commit);
    return state;
  }
  return applyJSONLLineToState(state, event.line, fileSnapshots);
}

export function formatEventText(event: TimelineEvent, repoPath: Path): string {
  if (event.type === TimelineEventKind.GitCommit) {
    return `next event: source:${repoPath.toString()} commit:${event.commit.toString()}`;
  }
  const source = getRecordSource(event.line);
  if (source === undefined) {
    throw new Error("formatEventText: the JSONL line has no source file");
  }
  return `next event: source:${source.filePath} line:${source.lineNumber}`;
}

export function executeReplay(state: Path, repoPath: Path, jsonlsPaths: Path[], fileSnapshots: Path[]): Path {
  let lastEvent: TimelineEvent | null = null;
  while (true) {
    const event = getNextEvent(repoPath, jsonlsPaths, lastEvent);
    if (event === TERMINAL_EVENT) {
      break;
    }
    console.log(formatEventText(event, repoPath));
    state = doSomethingWithEvent(state, event, repoPath, jsonlsPaths, fileSnapshots);
    lastEvent = event;
  }
  return state;
}

function readRequiredFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
  const { value, rest } = extractValueFlag(argumentList, flag);
  if (value === undefined) {
    throw new Error(USAGE);
  }
  return { value, rest };
}

function readReplaySettingsFromArguments(argumentList: string[]): ReplaySettings {
  const gitRepo = readRequiredFlag(argumentList, "--git-repo");
  const stateFlag = readRequiredFlag(gitRepo.rest, "--state");
  const touchedFlag = readRequiredFlag(stateFlag.rest, "--touched-out");
  const jsonlsPaths: Path[] = [];
  let rest = touchedFlag.rest;
  let hasJsonlFlag = rest.includes(JSONL_FLAG);
  while (hasJsonlFlag) {
    const jsonlFlag = readRequiredFlag(rest, JSONL_FLAG);
    jsonlsPaths.push(new Path(jsonlFlag.value));
    rest = jsonlFlag.rest;
    hasJsonlFlag = rest.includes(JSONL_FLAG);
  }
  if (jsonlsPaths.length === 0) {
    throw new Error(USAGE);
  }
  return { repoPath: new Path(gitRepo.value), state: new Path(stateFlag.value), jsonlsPaths, touchedOutput: new Path(touchedFlag.value) };
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

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const settings = readReplaySettingsFromArguments(process.argv.slice(2));
  assertSafeToReplay(settings.state);
  copyRepoIntoState(settings.repoPath, settings.state);
  executeReplay(settings.state, settings.repoPath, settings.jsonlsPaths, []);
  for (const line of compareStateToHead(settings.state, settings.repoPath)) {
    console.log(line);
  }
  writeTouchedPathsFile(settings.state, settings.touchedOutput);
}
