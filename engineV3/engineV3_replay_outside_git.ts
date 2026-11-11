// Replays git actions the user did in an outside terminal: rows of the copied repo's HEAD log that no Bash call covers.

import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { parseLogFile } from "./engineV3_replay_git.ts";
import { isGitCommand } from "./engineV3_replay_script_git_env.ts";

export enum OutsideGitKind {
  Commit = "Commit",
  Checkout = "Checkout",
  Reset = "Reset",
}

export type OutsideGitRow = { seconds: number; oldCommit: string; newCommit: string; message: string; kind: OutsideGitKind };

const COMMIT_MESSAGE_PREFIX = "commit";
const CHECKOUT_MESSAGE_PREFIX = "checkout: moving from ";
const RESET_MESSAGE_PREFIX = "reset: moving to ";
const CHECKOUT_TARGET_SEPARATOR = " to ";
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

// Rows after the start second that fall in no Bash call's window, in reflog order.
export function listOutsideGitRows(sourceRepo: Path, bashCallResults: Map<string, BashCallResult>, startSeconds: number): OutsideGitRow[] {
  const rows: OutsideGitRow[] = [];
  for (const logLine of parseLogFile(join(sourceRepo.toString(), "logs", "HEAD"))) {
    const isAfterStart = logLine.seconds > startSeconds;
    if (isAfterStart) {
      const isInsideBashCall = isSecondsInBashCallWindow(logLine.seconds, bashCallResults);
      if (!isInsideBashCall) {
        rows.push({ ...logLine, kind: parseOutsideGitKind(logLine.message) });
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
  // The reflog does not record the reset mode; the 2026-10-28T16:06:48Z reset kept an uncommitted edit on the Mac.
  // executeGit(state, ["reset", "-q", "--hard", row.newCommit]);
  executeGit(state, ["reset", "-q", "--mixed", row.newCommit]);
}

function assertStateHeadMatchesRow(state: Path, row: OutsideGitRow): void {
  const headCommit = executeGit(state, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (headCommit !== row.newCommit) {
    throw new Error(`applyOutsideGitRow: state HEAD ${headCommit} is not the row's new commit ${row.newCommit}`);
  }
}

export function applyOutsideGitRow(state: Path, sourceRepo: Path, row: OutsideGitRow): void {
  switch (row.kind) {
    case OutsideGitKind.Commit: applyOutsideCommitToState(state, sourceRepo, row); break;
    case OutsideGitKind.Checkout: applyOutsideCheckoutToState(state, row); break;
    case OutsideGitKind.Reset: applyOutsideResetToState(state, sourceRepo, row); break;
  }
  assertStateHeadMatchesRow(state, row);
}
