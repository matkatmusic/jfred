// CLI: node --import tsx engineV3/engineV3test.ts --settings <json file>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Path, Uuid } from "../src/structures/domain.ts";
import { RepoState, findRepoStateDifferences, isRepoStateEqual } from "../src/engine_v3_repo_state.ts";
import { getShortUuid } from "../src/reconstruction_branch_lookup.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { readRepoTreeAtRef } from "../src/layer1_repo_tree.ts";
import { readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";
import { applyJSONLLineToState, checkOutRepoAt, executeGit, logJSONLLineEvent, type CommitHash, type JSONLLine } from "./engineV3.ts";
import { getLineNumForCommit, loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";

export type EngineV3TestSettings = {
  repo: string;
  startingCommit: string;
  endingCommit: string;
  jsonlFolders: string[];
  snapshotFolders: string[];
};

// const SHORT_HASH_LENGTH = 7;
// function formatShortHash(commit: CommitHash): string {
//   return commit.toString().slice(0, SHORT_HASH_LENGTH);
// }

function convertToPaths(folders: string[]): Path[] {
  const paths: Path[] = [];
  for (const folder of folders) {
    paths.push(new Path(folder));
  }
  return paths;
}

// Every commit in the range, oldest first; each commit's previous one must be one of its parents.
export function listCommitsFromStartToEnd(repo: Path, startingCommit: CommitHash, endingCommit: CommitHash): CommitHash[] {
  const buffer = executeGit(repo, ["rev-list", "--date-order", "--reverse", "--parents", `${startingCommit}..${endingCommit}`]);
  const text = buffer.toString("utf8").trim();
  const rangeLines = text.length === 0 ? [] : text.split("\n");
  const commits: CommitHash[] = [startingCommit];
  for (const rangeLine of rangeLines) {
    const [hash, ...parents] = rangeLine.split(" ");
    const previous = (commits[commits.length - 1] as CommitHash).toString();
    const isConnected = parents.includes(previous);
    if (!isConnected) {
      throw new Error(`${hash} does not have the previous commit ${previous} as a parent`);
    }
    commits.push(new Uuid(hash as string));
  }
  return commits;
}

const SAME_SAVE_TIME_MS = 1000;

function readCommitTimeMs(repo: Path, commit: CommitHash): number {
  const commitTime = readCommitTimestamp(repo, commit);
  if (commitTime === undefined) {
    throw new Error(`cannot read the commit time of ${commit.toString()}`);
  }
  return commitTime.getTime();
}

// A commit saved within SAME_SAVE_TIME_MS of the next one is dropped; the first and the last commit stay.
export function filterCommitsSavedWithTheNext(repo: Path, commits: CommitHash[]): CommitHash[] {
  const keptCommits: CommitHash[] = [];
  const lastIndex = commits.length - 1;
  for (const [index, commit] of commits.entries()) {
    if (index === 0) {
      keptCommits.push(commit);
      continue;
    }
    if (index === lastIndex) {
      keptCommits.push(commit);
      continue;
    }
    const commitTimeMs = readCommitTimeMs(repo, commit);
    const nextCommitTimeMs = readCommitTimeMs(repo, commits[index + 1] as CommitHash);
    if (Math.abs(nextCommitTimeMs - commitTimeMs) < SAME_SAVE_TIME_MS) {
      console.log(`saved with the next commit, compared as one step: ${getShortUuid(commit)}`);
      continue;
    }
    keptCommits.push(commit);
  }
  return keptCommits;
}

// Only git-tracked files are compared, so files the child commit does not track are removed.
// function removeUntrackedPaths(state: RepoState, repo: Path, childCommit: CommitHash): void {
//   const trackedFiles = readRepoTreeAtRef(repo, childCommit.toString()).trackedFiles;
//   const trackedPaths = new Set<string>();
//   for (const trackedFile of trackedFiles) {
//     trackedPaths.add(trackedFile.toString());
//   }
//   for (const path of state.listPaths()) {
//     const isTracked = trackedPaths.has(path.toString());
//     if (!isTracked) {
//       console.log(`untracked in ${getShortUuid(childCommit)}: ${path.toString()}`);
//       state.removePath(path);
//     }
//   }
// }

// Only git-tracked files are compared; the carried state is not changed, so work not yet saved stays in it.
function selectTrackedPaths(state: RepoState, repo: Path, childCommit: CommitHash): RepoState {
  const trackedFiles = readRepoTreeAtRef(repo, childCommit.toString()).trackedFiles;
  const trackedPaths = new Set<string>();
  for (const trackedFile of trackedFiles) {
    trackedPaths.add(trackedFile.toString());
  }
  const trackedState = new RepoState();
  for (const path of state.listPaths()) {
    const isTracked = trackedPaths.has(path.toString());
    if (!isTracked) {
      console.log(`untracked in ${getShortUuid(childCommit)}: ${path.toString()}`);
      continue;
    }
    trackedState.set(path, state.get(path) as Buffer);
  }
  return trackedState;
}

function applyLinesToState(state: RepoState, jsonlLines: JSONLLine[], startingLineNum: number, endingLineNum: number, snapshotPaths: Path[], repo: Path): RepoState {
  let lineNum = startingLineNum;
  while (lineNum < endingLineNum) {
    const line = jsonlLines[lineNum] as JSONLLine;
    logJSONLLineEvent(line, repo);
    state = applyJSONLLineToState(state, line, snapshotPaths, repo);
    lineNum++;
  }
  return state;
}

function verifyCommitPair(repo: Path, carriedState: RepoState, parentCommit: CommitHash, childCommit: CommitHash, pairLabel: string, jsonlLines: JSONLLine[], snapshotPaths: Path[]): RepoState {
  const startingLineNum = getLineNumForCommit(repo, parentCommit, jsonlLines);
  const endingLineNum = getLineNumForCommit(repo, childCommit, jsonlLines);
  console.log(`pair ${pairLabel}: ${getShortUuid(parentCommit)} -> ${getShortUuid(childCommit)}, ${endingLineNum - startingLineNum} lines`);
  const endingState = checkOutRepoAt(repo, childCommit);
  const state = applyLinesToState(carriedState, jsonlLines, startingLineNum, endingLineNum, snapshotPaths, repo);
  const trackedState = selectTrackedPaths(state, repo, childCommit);
  const isReconstructed = isRepoStateEqual(endingState, trackedState);
  if (!isReconstructed) {
    console.log(JSON.stringify(findRepoStateDifferences(endingState, trackedState)));
    throw new Error(`failed reconstruction between ${getShortUuid(parentCommit)} and ${getShortUuid(childCommit)}`);
  }
  return state;
}

export function executeEngineV3Test(settings: EngineV3TestSettings): void {
  const repo = new Path(settings.repo);
  const snapshotPaths = convertToPaths(settings.snapshotFolders);
  const { jsonlLines } = loadMergedJSONLLines(settings.jsonlFolders);
  const allCommits = listCommitsFromStartToEnd(repo, new Uuid(settings.startingCommit), new Uuid(settings.endingCommit));
  const commits = filterCommitsSavedWithTheNext(repo, allCommits);
  const totalPairs = commits.length - 1;
  let carriedState = checkOutRepoAt(repo, commits[0] as CommitHash);
  let pairNumber = 0;
  while (pairNumber < totalPairs) {
    const pairLabel = `${pairNumber + 1}/${totalPairs}`;
    carriedState = verifyCommitPair(repo, carriedState, commits[pairNumber] as CommitHash, commits[pairNumber + 1] as CommitHash, pairLabel, jsonlLines, snapshotPaths);
    pairNumber++;
  }
  console.log(`all ${totalPairs} pairs passed`);
}

function readSettingsFromArguments(argumentList: string[]): EngineV3TestSettings {
  const settingsFile = extractValueFlag(argumentList, "--settings").value;
  if (settingsFile === undefined) {
    throw new Error("usage: node --import tsx engineV3/engineV3test.ts --settings <json file>");
  }
  return JSON.parse(readFileSync(settingsFile, "utf8")) as EngineV3TestSettings;
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  executeEngineV3Test(readSettingsFromArguments(process.argv.slice(2)));
}
