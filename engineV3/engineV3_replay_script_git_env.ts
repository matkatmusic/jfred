// Git settings for a recorded git call: the names and times of the commit it made, and a check that HEAD lands on the recorded commit.

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { parseLogFile, type LogLine } from "./engineV3_replay_git.ts";
import { moveHeadToRealCommitWhenSameFiles } from "./engineV3_replay_script_git_adopt.ts";

type SecondsWindow = { from: number; to: number };
type SpawnOutput = { stdout: string; stderr: string };

const OUTPUT_TAIL_CHARACTERS = 4000;

const WINDOW_PADDING_SECONDS = 1;
const COMMIT_FIELDS_FORMAT = "%an%n%ae%n%ad%n%cn%n%ce%n%cd";

function isGitCommand(command: string): boolean {
  return command.includes("git");
}

const READ_ONLY_GIT_VERBS = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "reflog"]);
const GIT_VERB_PATTERN = /\bgit\s+(?:-\S+\s+)*([a-z][a-z-]*)/g;

// True when the command names git calls and every one of them only reads, so the HEAD log rows in its window came from someone else.
function isOnlyReadOnlyGitCommand(command: string): boolean {
  const verbs = [...command.matchAll(GIT_VERB_PATTERN)].map((match) => match[1] as string);
  if (verbs.length === 0) {
    return false;
  }
  return verbs.every((verb) => READ_ONLY_GIT_VERBS.has(verb));
}

function getWindowOfCall(result: BashCallResult): SecondsWindow {
  return { from: result.startMs / 1000 - WINDOW_PADDING_SECONDS, to: result.endMs / 1000 + WINDOW_PADDING_SECONDS };
}

function isInWindow(seconds: number, window: SecondsWindow): boolean {
  if (seconds < window.from) {
    return false;
  }
  return seconds <= window.to;
}

function getMainHeadLogFile(sourceRepo: Path): string {
  return join(sourceRepo.toString(), "logs", "HEAD");
}

function listLogRowsInWindow(logFile: string, window: SecondsWindow): LogLine[] {
  const rows = parseLogFile(logFile);
  const rowsInWindow: LogLine[] = [];
  for (const row of rows) {
    if (isInWindow(row.seconds, window)) {
      rowsInWindow.push(row);
    }
  }
  return rowsInWindow;
}

function readCommitterSeconds(sourceRepo: Path, commit: string): number {
  const text = executeGit(sourceRepo, ["show", "-s", "--format=%ct", commit]).toString();
  return Number(text.trim());
}

function findLastCommitMadeInWindow(sourceRepo: Path, rows: LogLine[], window: SecondsWindow): string | undefined {
  let lastCommit: string | undefined = undefined;
  for (const row of rows) {
    const committerSeconds = readCommitterSeconds(sourceRepo, row.newCommit);
    if (isInWindow(committerSeconds, window)) {
      lastCommit = row.newCommit;
    }
  }
  return lastCommit;
}

function readGitEnvOfCommit(sourceRepo: Path, commit: string): Record<string, string> {
  const text = executeGit(sourceRepo, ["show", "-s", "--date=raw", `--format=${COMMIT_FIELDS_FORMAT}`, commit]).toString();
  const fields = text.split("\n") as [string, string, string, string, string, string];
  return { GIT_AUTHOR_NAME: fields[0], GIT_AUTHOR_EMAIL: fields[1], GIT_AUTHOR_DATE: fields[2], GIT_COMMITTER_NAME: fields[3], GIT_COMMITTER_EMAIL: fields[4], GIT_COMMITTER_DATE: fields[5] };
}

// The environment that makes a replayed git command write the commit with the recorded names and times.
export function getGitEnvForCall(command: string, result: BashCallResult, sourceRepo: Path): Record<string, string> {
  if (!isGitCommand(command)) {
    return {};
  }
  const window = getWindowOfCall(result);
  const rows = listLogRowsInWindow(getMainHeadLogFile(sourceRepo), window);
  const commit = findLastCommitMadeInWindow(sourceRepo, rows, window);
  if (commit === undefined) {
    return {};
  }
  return readGitEnvOfCommit(sourceRepo, commit);
}

export function getTailOfOutput(text: string): string {
  return text.slice(-OUTPUT_TAIL_CHARACTERS);
}

function listFileDifferences(state: Path, diffArgs: string[]): string {
  return executeGit(state, ["diff", "--name-status", ...diffArgs]).toString();
}

function readCommitLogLine(state: Path, commit: string): string {
  return executeGit(state, ["log", "--format=%H %an %ae %ad %cn %ce %cd", "--date=raw", "-1", commit]).toString().trim();
}

function createHeadMismatchMessage(command: string, expectedHash: string, actualHash: string, state: Path, output: SpawnOutput): string {
  const headDifferences = listFileDifferences(state, [expectedHash, "HEAD"]);
  const workTreeDifferences = listFileDifferences(state, [expectedHash]);
  const lines = [`assertHeadMatchesLog: the command left HEAD at ${actualHash} but the log says ${expectedHash}`, `command: ${command}`];
  lines.push(`files that differ, expected commit to HEAD:\n${headDifferences}`, `files that differ, expected commit to work tree:\n${workTreeDifferences}`);
  lines.push(`log line of HEAD: ${readCommitLogLine(state, "HEAD")}`, `log line of expected commit: ${readCommitLogLine(state, expectedHash)}`);
  lines.push(`stdout: ${getTailOfOutput(output.stdout)}`, `stderr: ${getTailOfOutput(output.stderr)}`);
  return lines.join("\n");
}

function isPathNamedInCommand(command: string, pathText: string): boolean {
  let searchFrom = 0;
  while (true) {
    const index = command.indexOf(pathText, searchFrom);
    if (index === -1) {
      return false;
    }
    const nextCharacter = command[index + pathText.length];
    if (nextCharacter === undefined) {
      return true;
    }
    if (!/[\w.-]/.test(nextCharacter)) {
      return true;
    }
    searchFrom = index + 1;
  }
}

// A command that names a linked worktree's folder acts in that worktree; a command that names none acts in the main work tree.
function findLinkedWorktreeNamedInCommand(command: string, state: Path): Path | undefined {
  const listing = executeGit(state, ["worktree", "list", "--porcelain"]).toString();
  const worktreeLines = listing.split("\n").filter((line) => line.startsWith("worktree "));
  const linkedWorktreeLines = worktreeLines.slice(1);
  for (const line of linkedWorktreeLines) {
    const worktreePath = line.slice("worktree ".length);
    if (isPathNamedInCommand(command, worktreePath)) {
      return new Path(worktreePath);
    }
  }
  return undefined;
}

// The Mac keeps a linked worktree's HEAD log at <git folder>/worktrees/<name>/logs/HEAD; the replay worktree has the same <name>.
function getLinkedWorktreeHeadLogFile(sourceRepo: Path, linkedWorktree: Path): string {
  const gitFolder = executeGit(linkedWorktree, ["rev-parse", "--absolute-git-dir"]).toString().trim();
  return join(sourceRepo.toString(), "worktrees", basename(gitFolder), "logs", "HEAD");
}

export function assertHeadMatchesLog(command: string, result: BashCallResult, sourceRepo: Path, state: Path, output: SpawnOutput): void {
  if (!isGitCommand(command)) {
    return;
  }
  if (isOnlyReadOnlyGitCommand(command)) {
    return;
  }
  const linkedWorktree = findLinkedWorktreeNamedInCommand(command, state);
  const headFolder = linkedWorktree ?? state;
  const logFile = linkedWorktree === undefined ? getMainHeadLogFile(sourceRepo) : getLinkedWorktreeHeadLogFile(sourceRepo, linkedWorktree);
  if (linkedWorktree !== undefined) {
    // The Mac deletes a worktree's log when the worktree is removed: a missing log leaves nothing to compare.
    if (!existsSync(logFile)) {
      return;
    }
  }
  const rows = listLogRowsInWindow(logFile, getWindowOfCall(result));
  if (rows.length === 0) {
    return;
  }
  const expectedHash = (rows[rows.length - 1] as LogLine).newCommit;
  const actualHash = executeGit(headFolder, ["rev-parse", "HEAD"]).toString().trim();
  if (actualHash !== expectedHash) {
    executeGit(headFolder, ["fetch", "-q", "--no-tags", sourceRepo.toString(), expectedHash]);
    if (moveHeadToRealCommitWhenSameFiles(headFolder, expectedHash, actualHash)) {
      return;
    }
    throw new Error(createHeadMismatchMessage(command, expectedHash, actualHash, headFolder, output));
  }
}
