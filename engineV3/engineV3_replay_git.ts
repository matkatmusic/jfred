// Gives the replay state folder a real .git whose branches, HEAD and index follow the copied repo's logs.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { executeGit, type CommitHash } from "./engineV3.ts";

export type LogLine = { oldCommit: string; newCommit: string; seconds: number; message: string };

// A log row is "<old> <new> <name> <email> <unix seconds> <timezone>\t<message>"; the name may hold spaces.
export function parseLogFile(logFile: string): LogLine[] {
  const rows = readFileSync(logFile, "utf8").split("\n");
  const logLines: LogLine[] = [];
  for (const row of rows) {
    if (row !== "") {
      const [head, message] = row.split("\t") as [string, string];
      const fields = head.split(" ");
      logLines.push({ oldCommit: fields[0] as string, newCommit: fields[1] as string, seconds: Number(fields[fields.length - 2]), message });
    }
  }
  return logLines;
}

function getBranchLogsFolder(repoPath: Path): string {
  return join(repoPath.toString(), "logs", "refs", "heads");
}

function listBranchNames(repoPath: Path): string[] {
  const branchLogsFolder = getBranchLogsFolder(repoPath);
  const entries = readdirSync(branchLogsFolder, { recursive: true }) as string[];
  const branchNames: string[] = [];
  for (const entry of entries) {
    const entryStats = statSync(join(branchLogsFolder, entry));
    const isFile = entryStats.isFile();
    if (isFile) {
      branchNames.push(entry);
    }
  }
  return branchNames;
}

function findSecondsOfCommit(headLogFile: string, commitText: string): number {
  for (const logLine of parseLogFile(headLogFile)) {
    const movesToCommit = logLine.newCommit === commitText;
    if (movesToCommit) {
      return logLine.seconds;
    }
  }
  throw new Error(`moveBranchesToCommitTime: no line in ${headLogFile} moves to ${commitText}`);
}

function findLastLogLineAtOrBefore(logLines: LogLine[], seconds: number): LogLine | undefined {
  let lastLine: LogLine | undefined = undefined;
  for (const logLine of logLines) {
    const isAtThatTime = logLine.seconds <= seconds;
    if (isAtThatTime) {
      lastLine = logLine;
    }
  }
  return lastLine;
}

function isCommitMadeInBranchLog(logLines: LogLine[], commitText: string, commitSeconds: number): boolean {
  for (const logLine of logLines) {
    const movesToCommit = logLine.newCommit === commitText;
    if (movesToCommit) {
      const isAtCommitTime = logLine.seconds === commitSeconds;
      if (isAtCommitTime) {
        return true;
      }
    }
  }
  return false;
}

function moveOneBranchToCommitTime(state: Path, branchName: string, logLines: LogLine[], commitSeconds: number): void {
  const lastLine = findLastLogLineAtOrBefore(logLines, commitSeconds);
  if (lastLine === undefined) {
    executeGit(state, ["update-ref", "-d", `refs/heads/${branchName}`]);
  }
  else {
    executeGit(state, ["update-ref", `refs/heads/${branchName}`, lastLine.newCommit]);
  }
}

// Returns the branches whose log shows the commit being made at that second.
function moveBranchesAndListCommitMakers(state: Path, repoPath: Path, commitText: string, commitSeconds: number): string[] {
  const commitMakers: string[] = [];
  for (const branchName of listBranchNames(repoPath)) {
    const branchLogLines = parseLogFile(join(getBranchLogsFolder(repoPath), branchName));
    moveOneBranchToCommitTime(state, branchName, branchLogLines, commitSeconds);
    const madeTheCommit = isCommitMadeInBranchLog(branchLogLines, commitText, commitSeconds);
    if (madeTheCommit) {
      commitMakers.push(branchName);
    }
  }
  return commitMakers;
}

function selectHeadBranch(commitMakers: string[], commitText: string, commitSeconds: number): string {
  if (commitMakers.length === 0) {
    throw new Error(`moveBranchesToCommitTime: no branch log has a line that moves to ${commitText} at ${commitSeconds}`);
  }
  if (commitMakers.length > 1) {
    throw new Error(`moveBranchesToCommitTime: commit ${commitText} at ${commitSeconds} matches more than one branch: ${commitMakers.join(", ")}`);
  }
  return commitMakers[0] as string;
}

export function copyRepoIntoState(repoPath: Path, state: Path): void {
  executeGit(state, ["clone", "--no-checkout", repoPath.toString(), state.toString()]);
}

// Branches and HEAD go to where the copied repo's logs had them when the commit was made.
export function moveBranchesToCommitTime(state: Path, repoPath: Path, commit: CommitHash): void {
  const commitText = commit.toString();
  const headLogFile = join(repoPath.toString(), "logs", "HEAD");
  const commitSeconds = findSecondsOfCommit(headLogFile, commitText);
  const commitMakers = moveBranchesAndListCommitMakers(state, repoPath, commitText, commitSeconds);
  const headBranch = selectHeadBranch(commitMakers, commitText, commitSeconds);
  executeGit(state, ["symbolic-ref", "HEAD", `refs/heads/${headBranch}`]);
  executeGit(state, ["read-tree", commitText]);
}
