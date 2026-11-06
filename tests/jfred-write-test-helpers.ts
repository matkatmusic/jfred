// Temp-repo fixtures and a hostile git environment for the jfred branch write and read tests.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRST_COMMIT_INSTANT, SECOND_COMMIT_INSTANT, executeGitCommand } from "./layer1-view-test-helpers.ts";

export interface JfredTempRepo {
  repoDir: string;
  commitHashes: string[];
}

const HOSTILE_VARIABLE_NAMES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

// --no-optional-locks keeps a read-only git call from refreshing the index and moving its mtime.
function readGitOutput(repoDir: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", ["--no-optional-locks", ...args], { cwd: repoDir, env, encoding: "utf8" }).trim();
}

// Trunk has C1 then C2; a.txt, sub/b.txt and run.sh (mode 755) all end with a newline.
export function createJfredTempRepo(): JfredTempRepo {
  const repoDir = mkdtempSync(join(tmpdir(), "jfred-write-repo-"));
  executeGitCommand(repoDir, "init -q -b trunk");
  executeGitCommand(repoDir, "config user.name jfred-test");
  executeGitCommand(repoDir, "config user.email jfred-test@example.com");
  mkdirSync(join(repoDir, "sub"));
  writeFileSync(join(repoDir, "a.txt"), "first\n");
  writeFileSync(join(repoDir, "sub", "b.txt"), "bee\n");
  writeFileSync(join(repoDir, "run.sh"), "#!/bin/sh\necho run\n");
  chmodSync(join(repoDir, "run.sh"), 0o755);
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m C1", FIRST_COMMIT_INSTANT);
  const firstCommitHash = readGitOutput(repoDir, ["rev-parse", "HEAD"]);
  writeFileSync(join(repoDir, "a.txt"), "second\n");
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m C2", SECOND_COMMIT_INSTANT);
  const secondCommitHash = readGitOutput(repoDir, ["rev-parse", "HEAD"]);
  return { repoDir, commitHashes: [firstCommitHash, secondCommitHash] };
}

function listFilesUnder(folder: string): string[] {
  const filePaths: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const entryPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...listFilesUnder(entryPath));
    }
    else {
      filePaths.push(entryPath);
    }
  }
  return filePaths;
}

// One string that changes when any ref, the head, the status, the index or any file under .git changes.
export function snapshotRepoState(repoDir: string): string {
  const refs = readGitOutput(repoDir, ["for-each-ref"]);
  const head = readGitOutput(repoDir, ["rev-parse", "HEAD"]);
  const status = readGitOutput(repoDir, ["status", "--porcelain"]);
  const indexEntries = readGitOutput(repoDir, ["ls-files", "-s"]);
  const gitFileLines: string[] = [];
  for (const filePath of listFilesUnder(join(repoDir, ".git")).sort()) {
    const fileStats = statSync(filePath);
    gitFileLines.push(`${filePath} ${fileStats.size} ${fileStats.mtimeMs}`);
  }
  return [refs, head, status, indexEntries, gitFileLines.join("\n")].join("\n--\n");
}

// Points the working folder and the git variables at the decoy repo, then restores all four.
export function runWithHostileGitEnvironment(decoyRepoDir: string, action: () => void): void {
  const originalFolder = process.cwd();
  const originalValues = new Map<string, string | undefined>();
  for (const name of HOSTILE_VARIABLE_NAMES) {
    originalValues.set(name, process.env[name]);
  }
  process.chdir(decoyRepoDir);
  process.env.GIT_DIR = join(decoyRepoDir, ".git");
  process.env.GIT_WORK_TREE = decoyRepoDir;
  process.env.GIT_INDEX_FILE = join(decoyRepoDir, ".git", "index");
  try {
    action();
  }
  finally {
    process.chdir(originalFolder);
    for (const [name, value] of originalValues) {
      if (value === undefined) {
        delete process.env[name];
      }
      else {
        process.env[name] = value;
      }
    }
  }
}

// Builds refs/heads/jfred with plain git: each commit reuses the parent's tree and takes the stated author and committer date.
export function createJfredBranchByPlainGit(repoDir: string, parentHash: string, messages: string[], authorDates: string[]): string[] {
  const treeHash = readGitOutput(repoDir, ["rev-parse", `${parentHash}^{tree}`]);
  const createdHashes: string[] = [];
  let previousHash = parentHash;
  for (const [index, message] of messages.entries()) {
    const authorDate = authorDates[index]!;
    const commitEnvironment = { ...process.env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: authorDate };
    previousHash = readGitOutput(repoDir, ["commit-tree", treeHash, "-p", previousHash, "-m", message], commitEnvironment);
    createdHashes.push(previousHash);
  }
  readGitOutput(repoDir, ["update-ref", "refs/heads/jfred", previousHash]);
  return createdHashes;
}
