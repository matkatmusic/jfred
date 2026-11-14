// Replays git actions the user did in an outside terminal: rows of the copied repo's HEAD log that no Bash call covers.

import { spawnSync } from "node:child_process";
// import { existsSync, readdirSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { parseLogFile, type LogLine } from "./engineV3_replay_git.ts";
import { createStartRepo, readStartPoint } from "./engineV3_replay_git_start.ts";
import { isGitCommand } from "./engineV3_replay_script_git_env.ts";
import { getSubmoduleGitFolder, getUploadPackOption, listSubmodulePaths } from "./engineV3_replay_submodule.ts";

export enum OutsideGitKind {
  Commit = "Commit",
  Checkout = "Checkout",
  Reset = "Reset",
  SubmoduleClone = "SubmoduleClone",
  SubmodulePull = "SubmodulePull",
  SubmoduleCommit = "SubmoduleCommit",
  HeadMove = "HeadMove",
  Clone = "Clone",
  FastForwardPull = "FastForwardPull",
}

// submodulePath is undefined for a row of the parent repo.
export type OutsideGitRow = { seconds: number; oldCommit: string; newCommit: string; message: string; kind: OutsideGitKind; submodulePath?: Path };

const EMPTY_MESSAGE = "";
const COMMIT_MESSAGE_PREFIX = "commit";
const CHECKOUT_MESSAGE_PREFIX = "checkout: moving from ";
const RESET_MESSAGE_PREFIX = "reset: moving to ";
const CLONE_MESSAGE_PREFIX = "clone: from ";
const PULL_MESSAGE_PREFIX = "pull ";
const SUBMODULE_PULL_MESSAGE_PREFIX = "pull";
const FAST_FORWARD_MESSAGE_SUFFIX = ": Fast-forward";
const CHECKOUT_TARGET_SEPARATOR = " to ";
// const SUBMODULES_FOLDER = "modules";
// const SUBMODULE_HEAD_LOG_SUFFIX = "/logs/HEAD";
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

const SCRIPT_FILE_PATTERN = /\.(sh|bash|py|mts|ts|js|mjs)\b/;

// A command that names no git and runs no script file (for example `jq ...; ls ...`) made none of the rows in its window.
function canCommandMakeReflogRow(command: string): boolean {
  if (isGitCommand(command)) {
    return true;
  }
  return SCRIPT_FILE_PATTERN.test(command);
}

function isSecondsInBashCallWindow(seconds: number, bashCallResults: Map<string, BashCallResult>): boolean {
  for (const result of bashCallResults.values()) {
    if (!canCommandMakeReflogRow(result.command)) {
      continue;
    }
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

// Log rows after the start second that fall in no Bash call's window, in log order.
function listLogLinesOutsideBashCalls(logFile: string, bashCallResults: Map<string, BashCallResult>, startSeconds: number): LogLine[] {
  const logLines: LogLine[] = [];
  for (const logLine of parseLogFile(logFile)) {
    const isAfterStart = logLine.seconds > startSeconds;
    if (isAfterStart) {
      const isInsideBashCall = isSecondsInBashCallWindow(logLine.seconds, bashCallResults);
      if (!isInsideBashCall) {
        logLines.push(logLine);
      }
    }
  }
  return logLines;
}

// // The submodule git folders are modules/<submodule path>, each with its own logs/HEAD.
// function listSubmodulePaths(sourceRepo: Path): Path[] {
//   const modulesFolder = join(sourceRepo.toString(), SUBMODULES_FOLDER);
//   if (!existsSync(modulesFolder)) {
//     return [];
//   }
//   const submodulePaths: Path[] = [];
//   for (const entry of readdirSync(modulesFolder, { recursive: true }) as string[]) {
//     if (entry.endsWith(SUBMODULE_HEAD_LOG_SUFFIX)) {
//       submodulePaths.push(new Path(entry.slice(0, -SUBMODULE_HEAD_LOG_SUFFIX.length)));
//     }
//   }
//   return submodulePaths;
// }

// A submodule's clone, pull and commit rows take the submodule paths; any other message takes the parent repo's kinds.
function parseSubmoduleKind(message: string): OutsideGitKind {
  if (message.startsWith(CLONE_MESSAGE_PREFIX)) {
    return OutsideGitKind.SubmoduleClone;
  }
  if (message.startsWith(SUBMODULE_PULL_MESSAGE_PREFIX)) {
    return OutsideGitKind.SubmodulePull;
  }
  if (message.startsWith(COMMIT_MESSAGE_PREFIX)) {
    return OutsideGitKind.SubmoduleCommit;
  }
  return parseOutsideGitKind(message);
}

// Rows after the start second that fall in no Bash call's window: the repo's rows, then each submodule's rows, in time order.
export function listOutsideGitRows(sourceRepo: Path, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
  const rows: OutsideGitRow[] = [];
  for (const logLine of listLogLinesOutsideBashCalls(join(sourceRepo.toString(), "logs", "HEAD"), bashCallResults, startSeconds)) {
    rows.push({ ...logLine, kind: parseOutsideGitKind(logLine.message) });
  }
  for (const submodulePath of listSubmodulePaths(sourceRepo)) {
    const submoduleLogFile = join(getSubmoduleGitFolder(sourceRepo, submodulePath).toString(), "logs", "HEAD");
    for (const logLine of listLogLinesOutsideBashCalls(submoduleLogFile, bashCallResults, startSeconds)) {
      rows.push({ ...logLine, kind: parseSubmoduleKind(logLine.message), submodulePath });
    }
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
  // The reflog does not record the reset mode; the Mac's 2026-10-28T16:06:48Z reset kept an uncommitted edit AND brought in docs/ from the target, which is --keep.
  // executeGit(state, ["reset", "-q", "--hard", row.newCommit]);
  // executeGit(state, ["reset", "-q", "--mixed", row.newCommit]);
  // A --start-at restore rewrites files, so the index stat data is stale; status refreshes it and exits 0 even when content differs.
  executeGit(state, ["status", "--porcelain", "-uno"]);
  executeGit(state, ["reset", "-q", "--keep", row.newCommit]);
}

function getRequiredSubmodulePath(row: OutsideGitRow): Path {
  if (row.submodulePath === undefined) {
    throw new Error(`getRequiredSubmodulePath: the ${row.kind} row ${row.newCommit} has no submodule path`);
  }
  return row.submodulePath;
}

// function getSubmoduleGitFolder(sourceRepo: Path, submodulePath: Path): string {
//   return join(sourceRepo.toString(), SUBMODULES_FOLDER, submodulePath.toString());
// }

function readCurrentBranch(repo: Path): string {
  return executeGit(repo, ["symbolic-ref", "--short", "HEAD"]).toString("utf8").trim();
}

// Leaves what the Mac's `git submodule add <GitHub URL> <path>` left: the submodule on its branch at the clone commit, .gitmodules and the gitlink staged, the GitHub URL everywhere.
function applySubmoduleCloneToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  const submodulePath = getRequiredSubmodulePath(row);
  const submodulePathText = submodulePath.toString();
  const githubUrl = row.message.slice(CLONE_MESSAGE_PREFIX.length);
  const submoduleState = new Path(join(state.toString(), submodulePathText));
  executeGit(state, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", getSubmoduleGitFolder(sourceRepo, submodulePath).toString(), submodulePathText]);
  // The local copy is at its newest commit; the Mac cloned at the clone commit.
  executeGit(submoduleState, ["reset", "-q", "--hard", row.newCommit]);
  executeGit(submoduleState, ["update-ref", `refs/remotes/origin/${readCurrentBranch(submoduleState)}`, row.newCommit]);
  executeGit(submoduleState, ["remote", "set-url", "origin", githubUrl]);
  executeGit(state, ["config", "-f", ".gitmodules", `submodule.${submodulePathText}.url`, githubUrl]);
  executeGit(state, ["config", `submodule.${submodulePathText}.url`, githubUrl]);
  executeGit(state, ["add", ".gitmodules", submodulePathText]);
}

function applySubmodulePullToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  const submodulePath = getRequiredSubmodulePath(row);
  const submoduleState = new Path(join(state.toString(), submodulePath.toString()));
  const originBranchRef = `refs/remotes/origin/${readCurrentBranch(submoduleState)}`;
  executeGit(submoduleState, ["fetch", "-q", "--no-tags", getSubmoduleGitFolder(sourceRepo, submodulePath).toString(), `+${row.newCommit}:${originBranchRef}`]);
  executeGit(submoduleState, ["merge", "-q", "--ff-only", row.newCommit]);
}

// Reuses the main-repo commit path with the submodule's work tree as the state and its git folder as the source.
function applySubmoduleCommitToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  const submodulePath = getRequiredSubmodulePath(row);
  const submoduleState = new Path(join(state.toString(), submodulePath.toString()));
  applyOutsideCommitToState(submoduleState, getSubmoduleGitFolder(sourceRepo, submodulePath), row);
}

function applyOutsideHeadMoveToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  executeGit(state, ["update-ref", "HEAD", row.newCommit]);
}

function assertHeadMatchesRow(repo: Path, row: OutsideGitRow): void {
  const headCommit = executeGit(repo, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (headCommit !== row.newCommit) {
    throw new Error(`applyOutsideGitRow: ${repo.toString()} HEAD ${headCommit} is not the row's new commit ${row.newCommit}`);
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
    case OutsideGitKind.SubmoduleClone: applySubmoduleCloneToState(state, sourceRepo, row); break;
    case OutsideGitKind.SubmodulePull: applySubmodulePullToState(state, sourceRepo, row); break;
    case OutsideGitKind.SubmoduleCommit: applySubmoduleCommitToState(state, sourceRepo, row); break;
  }
  assertHeadMatchesRow(rowState, row);
}
