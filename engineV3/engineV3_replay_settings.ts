// Reads the engineV3_replay.ts command line flags into one settings object.

import { Path } from "../src/structures/domain.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";

export type ReplaySettings = { repoPath: Path; state: Path; jsonlsPaths: Path[]; touchedOutput: Path; macPlatePath: Path; jotPath: Path };

const JSONL_FLAG = "--jsonl";
const USAGE = "usage: node engineV3_replay.mjs --git-repo <path> --state <folder> --touched-out <file> --mac-plate <folder> --jot <folder> --jsonl <folder> [--jsonl <folder> ...]";

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

export function readReplaySettingsFromArguments(argumentList: string[]): ReplaySettings {
  const gitRepo = readRequiredFlag(argumentList, "--git-repo");
  const stateFlag = readRequiredFlag(gitRepo.rest, "--state");
  const touchedFlag = readRequiredFlag(stateFlag.rest, "--touched-out");
  const macPlateFlag = readRequiredFlag(touchedFlag.rest, "--mac-plate");
  const jotFlag = readRequiredFlag(macPlateFlag.rest, "--jot");
  const jsonlsPaths = readJsonlPaths(jotFlag.rest);
  return { repoPath: new Path(gitRepo.value), state: new Path(stateFlag.value), jsonlsPaths, touchedOutput: new Path(touchedFlag.value), macPlatePath: new Path(macPlateFlag.value), jotPath: new Path(jotFlag.value) };
}
