// Replays git actions the user did in an outside terminal: rows of the copied repo's HEAD log that no Bash call covers.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { parseLogFile, type LogLine } from "./engineV3_replay_git.ts";
import { isGitCommand } from "./engineV3_replay_script_git_env.ts";

export enum OutsideGitKind {
  Commit = "Commit",
  Checkout = "Checkout",
  Reset = "Reset",
  SubmoduleClone = "SubmoduleClone",
  SubmodulePull = "SubmodulePull",
}

export type OutsideGitRow = { seconds: number; oldCommit: string; newCommit: string; message: string; kind: OutsideGitKind; submodulePath?: Path };

const COMMIT_MESSAGE_PREFIX = "commit";
const CHECKOUT_MESSAGE_PREFIX = "checkout: moving from ";
const RESET_MESSAGE_PREFIX = "reset: moving to ";
const SUBMODULE_CLONE_MESSAGE_PREFIX = "clone: from ";
const SUBMODULE_PULL_MESSAGE_PREFIX = "pull";
const CHECKOUT_TARGET_SEPARATOR = " to ";
const SUBMODULES_FOLDER = "modules";
const SUBMODULE_HEAD_LOG_SUFFIX = "/logs/HEAD";
const WINDOW_MARGIN_SECONDS = 1;

function parseOutsideGitKind(message: string): OutsideGitKind {
  if (message.startsWith(COMMIT_MESSAGE_PREFIX)) {
    return OutsideGitKind.Commit;
  }
  if (message.startsWith(CHECKOUT_MESSAGE_PREFIX)) {
    return OutsideGitKind.Checkout;
  }
  if (message.startsWith(RESET_MESSAGE_PREFIX)) {
    return OutsideGitKind.Reset;
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

// The submodule git folders are modules/<submodule path>, each with its own logs/HEAD.
function listSubmodulePaths(sourceRepo: Path): Path[] {
  const modulesFolder = join(sourceRepo.toString(), SUBMODULES_FOLDER);
  if (!existsSync(modulesFolder)) {
    return [];
  }
  const submodulePaths: Path[] = [];
  for (const entry of readdirSync(modulesFolder, { recursive: true }) as string[]) {
    if (entry.endsWith(SUBMODULE_HEAD_LOG_SUFFIX)) {
      submodulePaths.push(new Path(entry.slice(0, -SUBMODULE_HEAD_LOG_SUFFIX.length)));
    }
  }
  return submodulePaths;
}

// User decision 2026-11-13: only the submodule's clone and pull rows are replayed; its commit rows are not.
function parseSubmoduleKind(message: string): OutsideGitKind | undefined {
  if (message.startsWith(SUBMODULE_CLONE_MESSAGE_PREFIX)) {
    return OutsideGitKind.SubmoduleClone;
  }
  if (message.startsWith(SUBMODULE_PULL_MESSAGE_PREFIX)) {
    return OutsideGitKind.SubmodulePull;
  }
  if (message.startsWith(COMMIT_MESSAGE_PREFIX)) {
    return undefined;
  }
  throw new Error(`parseSubmoduleKind: no replay for submodule reflog message "${message}"`);
}

// Rows after the start second that fall in no Bash call's window: the repo's rows in reflog order, then each submodule's clone and pull rows.
export function listOutsideGitRows(sourceRepo: Path, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
  const rows: OutsideGitRow[] = [];
  for (const logLine of listLogLinesOutsideBashCalls(join(sourceRepo.toString(), "logs", "HEAD"), bashCallResults, startSeconds)) {
    rows.push({ ...logLine, kind: parseOutsideGitKind(logLine.message) });
  }
  for (const submodulePath of listSubmodulePaths(sourceRepo)) {
    const submoduleLogFile = join(sourceRepo.toString(), SUBMODULES_FOLDER, submodulePath.toString(), "logs", "HEAD");
    for (const logLine of listLogLinesOutsideBashCalls(submoduleLogFile, bashCallResults, startSeconds)) {
      const kind = parseSubmoduleKind(logLine.message);
      if (kind !== undefined) {
        rows.push({ ...logLine, kind, submodulePath });
      }
    }
  }
  return rows;
}

function fetchCommitIntoState(state: Path, sourceRepo: Path, commitText: string): void {
  executeGit(state, ["fetch", "-q", "--no-tags", sourceRepo.toString(), commitText]);
}

function applyOutsideCommitToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  fetchCommitIntoState(state, sourceRepo, row.newCommit);
  applyCommitToState(new Uuid(row.newCommit), state, sourceRepo);
  executeGit(state, ["update-ref", "HEAD", row.newCommit]);
  executeGit(state, ["read-tree", row.newCommit]);
}

function applyOutsideCheckoutToState(state: Path, row: OutsideGitRow): void {
  const targetStart = row.message.lastIndexOf(CHECKOUT_TARGET_SEPARATOR) + CHECKOUT_TARGET_SEPARATOR.length;
  executeGit(state, ["checkout", "-q", row.message.slice(targetStart)]);
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

function getSubmoduleGitFolder(sourceRepo: Path, submodulePath: Path): string {
  return join(sourceRepo.toString(), SUBMODULES_FOLDER, submodulePath.toString());
}

function readCurrentBranch(repo: Path): string {
  return executeGit(repo, ["symbolic-ref", "--short", "HEAD"]).toString("utf8").trim();
}

// Leaves what the Mac's `git submodule add <GitHub URL> <path>` left: the submodule on its branch at the clone commit, .gitmodules and the gitlink staged, the GitHub URL everywhere.
function applySubmoduleCloneToState(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  const submodulePath = getRequiredSubmodulePath(row);
  const submodulePathText = submodulePath.toString();
  const githubUrl = row.message.slice(SUBMODULE_CLONE_MESSAGE_PREFIX.length);
  const submoduleState = new Path(join(state.toString(), submodulePathText));
  executeGit(state, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", getSubmoduleGitFolder(sourceRepo, submodulePath), submodulePathText]);
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
  executeGit(submoduleState, ["fetch", "-q", "--no-tags", getSubmoduleGitFolder(sourceRepo, submodulePath), `+${row.newCommit}:${originBranchRef}`]);
  executeGit(submoduleState, ["merge", "-q", "--ff-only", row.newCommit]);
}

function assertHeadMatchesRow(repo: Path, row: OutsideGitRow): void {
  const headCommit = executeGit(repo, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (headCommit !== row.newCommit) {
    throw new Error(`applyOutsideGitRow: ${repo.toString()} HEAD ${headCommit} is not the row's new commit ${row.newCommit}`);
  }
}

export function applyOutsideGitRow(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  switch (row.kind) {
    case OutsideGitKind.Commit: applyOutsideCommitToState(state, sourceRepo, row); break;
    case OutsideGitKind.Checkout: applyOutsideCheckoutToState(state, row); break;
    case OutsideGitKind.Reset: applyOutsideResetToState(state, sourceRepo, row); break;
    case OutsideGitKind.SubmoduleClone: applySubmoduleCloneToState(state, sourceRepo, row); break;
    case OutsideGitKind.SubmodulePull: applySubmodulePullToState(state, sourceRepo, row); break;
  }
  const isSubmoduleRow = row.submodulePath !== undefined;
  if (isSubmoduleRow) {
    assertHeadMatchesRow(new Path(join(state.toString(), getRequiredSubmodulePath(row).toString())), row);
    return;
  }
  assertHeadMatchesRow(state, row);
}
