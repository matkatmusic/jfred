// Replays git actions the user did in an outside terminal: rows of the copied repo's HEAD log that no Bash call covers.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { parseLogFile } from "./engineV3_replay_git.ts";
import { createStartRepo, readStartPoint } from "./engineV3_replay_git_start.ts";
import { getSubmoduleGitFolder, getUploadPackOption, listSubmodulePaths } from "./engineV3_replay_submodule.ts";

export enum OutsideGitKind {
  Commit = "Commit",
  Checkout = "Checkout",
  Reset = "Reset",
  HeadMove = "HeadMove",
  Clone = "Clone",
  FastForwardPull = "FastForwardPull",
}

// export type OutsideGitRow = { seconds: number; oldCommit: string; newCommit: string; message: string; kind: OutsideGitKind };
// submodulePath is undefined for a row of the parent repo.
export type OutsideGitRow = { seconds: number; oldCommit: string; newCommit: string; message: string; kind: OutsideGitKind; submodulePath: Path | undefined };

const EMPTY_MESSAGE = "";
const COMMIT_MESSAGE_PREFIX = "commit";
const CHECKOUT_MESSAGE_PREFIX = "checkout: moving from ";
const RESET_MESSAGE_PREFIX = "reset: moving to ";
const CLONE_MESSAGE_PREFIX = "clone: from ";
const PULL_MESSAGE_PREFIX = "pull ";
const FAST_FORWARD_MESSAGE_SUFFIX = ": Fast-forward";
const CHECKOUT_TARGET_SEPARATOR = " to ";
const WINDOW_MARGIN_SECONDS = 1;

function parseOutsideGitKind(message: string): OutsideGitKind {
  if (message === EMPTY_MESSAGE) {
    return OutsideGitKind.HeadMove;
  }
  if (message.startsWith(COMMIT_MESSAGE_PREFIX)) {
    return OutsideGitKind.Commit;
  }
  if (message.startsWith(CHECKOUT_MESSAGE_PREFIX)) {
    return OutsideGitKind.Checkout;
  }
  if (message.startsWith(RESET_MESSAGE_PREFIX)) {
    return OutsideGitKind.Reset;
  }
  if (message.startsWith(CLONE_MESSAGE_PREFIX)) {
    return OutsideGitKind.Clone;
  }
  if (message.startsWith(PULL_MESSAGE_PREFIX)) {
    if (message.endsWith(FAST_FORWARD_MESSAGE_SUFFIX)) {
      return OutsideGitKind.FastForwardPull;
    }
  }
  throw new Error(`parseOutsideGitKind: no replay for reflog message "${message}"`);
}

function isSecondsInBashCallWindow(seconds: number, bashCallResults: Map<string, BashCallResult>): boolean {
  for (const result of bashCallResults.values()) {
    const isAfterStart = seconds >= result.startMs / 1000 - WINDOW_MARGIN_SECONDS;
    if (isAfterStart) {
      const isBeforeEnd = seconds <= result.endMs / 1000 + WINDOW_MARGIN_SECONDS;
      if (isBeforeEnd) {
        return true;
      }
    }
  }
  return false;
}

// // Rows after the start second that fall in no Bash call's window, in reflog order.
// export function listOutsideGitRows(sourceRepo: Path, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
//   const rows: OutsideGitRow[] = [];
//   for (const logLine of parseLogFile(join(sourceRepo.toString(), "logs", "HEAD"))) {
//     const isAfterStart = logLine.seconds > startSeconds;
//     if (isAfterStart) {
//       const isInsideBashCall = isSecondsInBashCallWindow(logLine.seconds, bashCallResults);
//       if (!isInsideBashCall) {
//         rows.push({ ...logLine, kind: parseOutsideGitKind(logLine.message) });
//       }
//     }
//   }
//   return rows;
// }

// Rows of one repo's HEAD log after the start second that fall in no Bash call's window, in reflog order.
function listOutsideGitRowsOfRepo(gitFolder: Path, submodulePath: Path | undefined, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
  const rows: OutsideGitRow[] = [];
  for (const logLine of parseLogFile(join(gitFolder.toString(), "logs", "HEAD"))) {
    const isAfterStart = logLine.seconds > startSeconds;
    if (isAfterStart) {
      const isInsideBashCall = isSecondsInBashCallWindow(logLine.seconds, bashCallResults);
      if (!isInsideBashCall) {
        rows.push({ ...logLine, kind: parseOutsideGitKind(logLine.message), submodulePath });
      }
    }
  }
  return rows;
}

// The parent repo's rows and each submodule's rows, in time order.
export function listOutsideGitRows(sourceRepo: Path, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
  const rows = listOutsideGitRowsOfRepo(sourceRepo, undefined, bashCallResults, startSeconds);
  for (const submodulePath of listSubmodulePaths(sourceRepo)) {
    rows.push(...listOutsideGitRowsOfRepo(getSubmoduleGitFolder(sourceRepo, submodulePath), submodulePath, bashCallResults, startSeconds));
  }
  // ponytail: a stable sort keeps each HEAD log's order because every known HEAD log only goes forward in time.
  return rows.sort((first, second) => first.seconds - second.seconds);
}

function fetchCommitIntoState(state: Path, sourceRepo: Path, commitText: string): void {
  // The state holds submodule files without a submodule git folder, so a fetch must not try to fetch the submodules too.
  // executeGit(state, ["fetch", "-q", "--no-tags", sourceRepo.toString(), commitText]);
  // executeGit(state, ["fetch", "-q", "--no-tags", "--no-recurse-submodules", sourceRepo.toString(), commitText]);
  executeGit(state, ["fetch", "-q", "--no-tags", "--no-recurse-submodules", getUploadPackOption(sourceRepo), sourceRepo.toString(), commitText]);
}

function applyOutsideCommitToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  applyCommitToState(new Uuid(row.newCommit), state, sourceRepo);
  executeGit(state, ["update-ref", "HEAD", row.newCommit]);
  executeGit(state, ["read-tree", row.newCommit]);
}

function isRevisionInState(state: Path, revision: string): boolean {
  return spawnSync("git", ["rev-parse", "--verify", "--quiet", revision], { cwd: state.toString() }).status === 0;
}

function applyOutsideCheckoutToState(state: Path, row: OutsideGitRow): void {
  const targetStart = row.message.lastIndexOf(CHECKOUT_TARGET_SEPARATOR) + CHECKOUT_TARGET_SEPARATOR.length;
  // executeGit(state, ["checkout", "-q", row.message.slice(targetStart)]);
  const target = row.message.slice(targetStart);
  if (!isRevisionInState(state, target)) {
    // A terminal `git checkout -b` writes no HEAD log row for the branch creation, so create the branch here.
    executeGit(state, ["checkout", "-q", "-b", target, row.newCommit]);
    return;
  }
  executeGit(state, ["checkout", "-q", target]);
}

function applyOutsideResetToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  executeGit(state, ["reset", "-q", "--hard", row.newCommit]);
}

function applyOutsideHeadMoveToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  executeGit(state, ["update-ref", "HEAD", row.newCommit]);
}

function assertStateHeadMatchesRow(state: Path, row: OutsideGitRow): void {
  const headCommit = executeGit(state, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (headCommit !== row.newCommit) {
    throw new Error(`applyOutsideGitRow: state HEAD ${headCommit} is not the row's new commit ${row.newCommit}`);
  }
}

// The clone's start refs follow the same reflog rule as the replay start repo, taken at the clone second.
function applyOutsideCloneToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  mkdirSync(state.toString(), { recursive: true });
  createStartRepo(sourceRepo, state, readStartPoint(sourceRepo, new Date(row.seconds * 1000)));
}

function applyOutsideFastForwardPullToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  executeGit(state, ["merge", "-q", "--ff-only", row.newCommit]);
}

// export function applyOutsideGitRow(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
//   switch (row.kind) {
//     case OutsideGitKind.Commit: applyOutsideCommitToState(state, sourceRepo, row); break;
//     case OutsideGitKind.Checkout: applyOutsideCheckoutToState(state, row); break;
//     case OutsideGitKind.Reset: applyOutsideResetToState(state, sourceRepo, row); break;
//     case OutsideGitKind.HeadMove: applyOutsideHeadMoveToState(state, sourceRepo, row); break;
//   }
//   assertStateHeadMatchesRow(state, row);
// }

// A submodule row runs in the submodule folder of the state, with the submodule's own git folder as the source.
export function applyOutsideGitRow(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  let rowState = state;
  let rowSourceRepo = sourceRepo;
  if (row.submodulePath !== undefined) {
    rowState = new Path(join(state.toString(), row.submodulePath.toString()));
    rowSourceRepo = getSubmoduleGitFolder(sourceRepo, row.submodulePath);
  }
  switch (row.kind) {
    case OutsideGitKind.Commit: applyOutsideCommitToState(rowState, rowSourceRepo, row); break;
    case OutsideGitKind.Checkout: applyOutsideCheckoutToState(rowState, row); break;
    case OutsideGitKind.Reset: applyOutsideResetToState(rowState, rowSourceRepo, row); break;
    case OutsideGitKind.HeadMove: applyOutsideHeadMoveToState(rowState, rowSourceRepo, row); break;
    case OutsideGitKind.Clone: applyOutsideCloneToState(rowState, rowSourceRepo, row); break;
    case OutsideGitKind.FastForwardPull: applyOutsideFastForwardPullToState(rowState, rowSourceRepo, row); break;
  }
  assertStateHeadMatchesRow(rowState, row);
}
