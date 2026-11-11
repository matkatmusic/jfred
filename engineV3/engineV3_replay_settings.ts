// Reads the engineV3_replay.ts command line flags into one settings object.

import { Path } from "../src/structures/domain.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import type { RecordSource } from "../src/parse/loadTranscript.ts";

export type ReplaySettings = { repoPath: Path | undefined; state: Path; jsonlsPaths: Path[]; touchedOutput: Path; macPlatePath: Path; jotPath: Path; fileHistoryPath: Path | undefined; startFilesPath: Path | undefined; snapshotsPath: Path | undefined; watchPaths: Path[]; stopBefore: RecordSource | undefined; startAt: number | undefined; writePlaygroundStartFiles: boolean };

const JSONL_FLAG = "--jsonl";
const PLAYGROUND_START_FILES_FLAG = "--playground-start-files";
const WATCH_FLAG = "--watch";
// The greedy path part splits at the LAST colon
const STOP_BEFORE_PATTERN = /^(.*):(\d+)$/;
const USAGE = "usage: node engineV3_replay.mjs [--git-repo <path>] --state <folder> --touched-out <file> --mac-plate <folder> --jot <folder> [--file-history <folder>] [--start-files <folder>] [--snapshots <folder>] [--start-at <event number>] [--watch <folder> ...] [--playground-start-files] [--stop-before <jsonl file>:<line>] --jsonl <folder> [--jsonl <folder> ...]";

function readRequiredFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
  const { value, rest } = extractValueFlag(argumentList, flag);
  if (value === undefined) {
    throw new Error(USAGE);
  }
  return { value, rest };
}

function readJsonlPaths(argumentList: string[]): Path[] {
  const jsonlsPaths: Path[] = [];
  let rest = argumentList;
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
  return jsonlsPaths;
}

function readOptionalPathFlag(argumentList: string[], flag: string): { path: Path | undefined; rest: string[] } {
  const { value, rest } = extractValueFlag(argumentList, flag);
  if (value === undefined) {
    return { path: undefined, rest };
  }
  return { path: new Path(value), rest };
}

function readOptionalStopBeforeFlag(argumentList: string[]): { stopBefore: RecordSource | undefined; rest: string[] } {
  const { value, rest } = extractValueFlag(argumentList, "--stop-before");
  if (value === undefined) {
    return { stopBefore: undefined, rest };
  }
  const match = STOP_BEFORE_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`--stop-before needs <jsonl file>:<line number>, got ${value}`);
  }
  return { stopBefore: { filePath: match[1]!, lineNumber: Number(match[2]) }, rest };
}

function readOptionalStartAtFlag(argumentList: string[]): { startAt: number | undefined; rest: string[] } {
  const { value, rest } = extractValueFlag(argumentList, "--start-at");
  if (value === undefined) {
    return { startAt: undefined, rest };
  }
  const startAt = Number(value);
  if (!Number.isInteger(startAt)) {
    throw new Error(`--start-at needs a whole event number of 1 or more, got ${value}`);
  }
  if (startAt < 1) {
    throw new Error(`--start-at needs a whole event number of 1 or more, got ${value}`);
  }
  return { startAt, rest };
}

function assertStartAtHasSnapshots(startAt: number | undefined, snapshotsPath: Path | undefined): void {
  if (startAt !== undefined) {
    if (snapshotsPath === undefined) {
      throw new Error("--start-at needs --snapshots <folder>");
    }
  }
}

function readWatchPaths(argumentList: string[]): { paths: Path[]; rest: string[] } {
  const paths: Path[] = [];
  let rest = argumentList;
  let hasWatchFlag = rest.includes(WATCH_FLAG);
  while (hasWatchFlag) {
    const watchFlag = readRequiredFlag(rest, WATCH_FLAG);
    paths.push(new Path(watchFlag.value));
    rest = watchFlag.rest;
    hasWatchFlag = rest.includes(WATCH_FLAG);
  }
  return { paths, rest };
}

export function readReplaySettingsFromArguments(argumentList: string[]): ReplaySettings {
  const gitRepo = readOptionalPathFlag(argumentList, "--git-repo");
  const stateFlag = readRequiredFlag(gitRepo.rest, "--state");
  const touchedFlag = readRequiredFlag(stateFlag.rest, "--touched-out");
  const macPlateFlag = readRequiredFlag(touchedFlag.rest, "--mac-plate");
  const jotFlag = readRequiredFlag(macPlateFlag.rest, "--jot");
  const fileHistory = readOptionalPathFlag(jotFlag.rest, "--file-history");
  const startFiles = readOptionalPathFlag(fileHistory.rest, "--start-files");
  const snapshots = readOptionalPathFlag(startFiles.rest, "--snapshots");
  const stopBefore = readOptionalStopBeforeFlag(snapshots.rest);
  const startAt = readOptionalStartAtFlag(stopBefore.rest);
  assertStartAtHasSnapshots(startAt.startAt, snapshots.path);
  const watch = readWatchPaths(startAt.rest.filter((argument) => argument !== PLAYGROUND_START_FILES_FLAG));
  const jsonlsPaths = readJsonlPaths(watch.rest);
  return { repoPath: gitRepo.path, state: new Path(stateFlag.value), jsonlsPaths, touchedOutput: new Path(touchedFlag.value), macPlatePath: new Path(macPlateFlag.value), jotPath: new Path(jotFlag.value), fileHistoryPath: fileHistory.path, startFilesPath: startFiles.path, snapshotsPath: snapshots.path, watchPaths: watch.paths, stopBefore: stopBefore.stopBefore, startAt: startAt.startAt, writePlaygroundStartFiles: startAt.rest.includes(PLAYGROUND_START_FILES_FLAG) };
}
