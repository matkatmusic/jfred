// Task 361 step 6c: builds the temp repo, project folder and transcript; git is refused outside the temp root.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWriteRecordPair } from "../../tests/tool-call-record-pair-builders.ts";
import { waitMilliseconds } from "./cdp.ts";

export interface RealRepo { rootDir: string; repoDir: string; projectsDir: string; fileHistoryDir: string; transcriptDir: string; baseHash: string }
export interface RepoState { head: string; branch: string; status: string; fileText: string }
export interface JfredCommitFacts { hash: string; parentHash: string; authorDate: Date; committerDate: Date; message: string; fileText: string }

export const REAL_FILE_NAME = "a.txt";
export const REAL_TEXTS = { base: "zero\n", secondCommit: "one\n", writeOne: "two\n", writeTwo: "three\n" } as const;
export const REAL_INSTANTS = {
  baseCommit: new Date("2026-06-01T09:00:00.000Z"), secondCommit: new Date("2026-06-01T10:00:00.000Z"),
  writeOne: new Date("2026-06-01T11:00:00.000Z"), writeTwo: new Date("2026-06-01T12:00:00.000Z"),
} as const;
export const REAL_TICKS = { baseCommit: "06-01 09:00:00.000", secondCommit: "06-01 10:00:00.000", writeOne: "06-01 11:00:00.000", writeTwo: "06-01 12:00:00.000" } as const;

const TEMP_ROOT = realpathSync(tmpdir());
const SESSION_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const REPO_POINTER_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_PREFIX"];
const SETTINGS_POLL_MS = 100;

function spawnGit(workDir: string, args: string[], input?: string, env: Record<string, string> = {}) {
  const isInsideTemp = workDir.startsWith(`${TEMP_ROOT}/`);
  if (!isInsideTemp) {
    throw new Error(`git is refused outside the temp folder: ${workDir}`);
  }
  const cleanEnvironment = { ...process.env };
  for (const name of REPO_POINTER_VARIABLES) {
    delete cleanEnvironment[name];
  }
  return spawnSync("git", args, { cwd: workDir, env: { ...cleanEnvironment, ...env }, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function executeGitExact(workDir: string, args: string[], input?: string, env?: Record<string, string>): string {
  const result = spawnGit(workDir, args, input, env);
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed in ${workDir}: ${result.stderr}`);
  }
  return result.stdout;
}

export function readGitTrimmed(workDir: string, args: string[]): string {
  return executeGitExact(workDir, args).trim();
}

function createDatedCommit(repoDir: string, text: string, message: string, instant: Date): void {
  writeFileSync(join(repoDir, REAL_FILE_NAME), text);
  executeGitExact(repoDir, ["add", REAL_FILE_NAME]);
  const isoDate = instant.toISOString();
  executeGitExact(repoDir, ["commit", "-q", "-m", message], undefined, { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate });
}

function writeTranscript(repoDir: string, transcriptDir: string): void {
  const filePath = join(repoDir, REAL_FILE_NAME);
  const envelope = { sessionId: SESSION_ID, cwd: repoDir };
  const first = buildWriteRecordPair({ ...envelope, timestamp: REAL_INSTANTS.writeOne.toISOString(), toolId: "toolu_real_w1", parentUuid: null }, filePath, REAL_TEXTS.writeOne);
  const second = buildWriteRecordPair({ ...envelope, timestamp: REAL_INSTANTS.writeTwo.toISOString(), toolId: "toolu_real_w2", parentUuid: first.lastUuid }, filePath, REAL_TEXTS.writeTwo);
  let jsonlText = "";
  for (const record of [...first.records, ...second.records]) {
    jsonlText += `${JSON.stringify(record)}\n`;
  }
  writeFileSync(join(transcriptDir, "a.jsonl"), jsonlText);
}

function initRepoWithIdentity(repoDir: string): void {
  mkdirSync(repoDir);
  executeGitExact(repoDir, ["init", "-q", "-b", "main"]);
  for (const [key, value] of [["user.name", "Real Check"], ["user.email", "real-check@example.invalid"], ["commit.gpgsign", "false"]]) {
    executeGitExact(repoDir, ["config", key!, value!]);
  }
}

// Two commits of a.txt, then two Writes of a.txt in the transcript; the working tree equals the second commit.
export function createRealRepo(): RealRepo {
  const rootDir = mkdtempSync(join(TEMP_ROOT, "jfred-l9-real-"));
  const repoDir = join(rootDir, "project");
  const projectsDir = join(rootDir, "projects");
  const transcriptDir = join(projectsDir, "-jfred-l9-real");
  const fileHistoryDir = join(rootDir, "file-history");
  mkdirSync(transcriptDir, { recursive: true });
  mkdirSync(fileHistoryDir);
  initRepoWithIdentity(repoDir);
  createDatedCommit(repoDir, REAL_TEXTS.base, "base", REAL_INSTANTS.baseCommit);
  const baseHash = readGitTrimmed(repoDir, ["rev-parse", "HEAD"]);
  createDatedCommit(repoDir, REAL_TEXTS.secondCommit, "second", REAL_INSTANTS.secondCommit);
  writeTranscript(repoDir, transcriptDir);
  return { rootDir, repoDir, projectsDir, fileHistoryDir, transcriptDir, baseHash };
}

export function readRepoState(repoDir: string): RepoState {
  return {
    head: readGitTrimmed(repoDir, ["rev-parse", "HEAD"]), branch: readGitTrimmed(repoDir, ["branch", "--show-current"]),
    status: executeGitExact(repoDir, ["status", "--porcelain"]), fileText: readFileSync(join(repoDir, REAL_FILE_NAME), "utf8"),
  };
}

export function listObjectFiles(repoDir: string): string[] {
  return readdirSync(join(repoDir, ".git", "objects"), { recursive: true, encoding: "utf8" }).sort();
}

// Empty when the jfred branch does not exist.
export function readJfredRef(repoDir: string): string {
  return readGitTrimmed(repoDir, ["for-each-ref", "--format=%(objectname)", "refs/heads/jfred"]);
}

// Newest first; the commits of jfred that HEAD does not reach, so the base is left out.
export function listJfredHashes(repoDir: string): string[] {
  const hasBranch = readJfredRef(repoDir) !== "";
  return hasBranch ? readGitTrimmed(repoDir, ["rev-list", "--first-parent", "HEAD..jfred"]).split("\n") : [];
}

export function readJfredCommitFacts(repoDir: string, hash: string): JfredCommitFacts {
  const [parentHash, authorIso, committerIso] = readGitTrimmed(repoDir, ["log", "-1", "--format=%P%n%aI%n%cI", hash]).split("\n");
  return {
    hash, parentHash: parentHash!, authorDate: new Date(authorIso!), committerDate: new Date(committerIso!),
    message: readGitTrimmed(repoDir, ["log", "-1", "--format=%B", hash]), fileText: executeGitExact(repoDir, ["show", `${hash}:${REAL_FILE_NAME}`]),
  };
}

// Exit status of `git apply --check` for the patch parent..commit, in a clone checked out at the parent.
export function measureApplyCheckStatus(repo: RealRepo, parentHash: string, commitHash: string): number {
  const patch = executeGitExact(repo.repoDir, ["diff", parentHash, commitHash]);
  const cloneDir = join(repo.rootDir, "clone-at-parent");
  executeGitExact(repo.rootDir, ["clone", "-q", repo.repoDir, cloneDir]);
  executeGitExact(cloneDir, ["checkout", "-q", parentHash]);
  return spawnGit(cloneDir, ["apply", "--check"], patch).status ?? -1;
}

function readSavedBaseHash(settingsFile: string, dir: string): string | undefined {
  const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as { projects?: Record<string, { jfredBaseHash?: string }> };
  return settings.projects?.[dir]?.jfredBaseHash;
}

// The page saves through a POST, so the file changes a moment after the click.
export async function waitUntilSavedBase(settingsFile: string, dir: string, expected: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isSaved = readSavedBaseHash(settingsFile, dir) === expected;
    if (isSaved) {
      return true;
    }
    await waitMilliseconds(SETTINGS_POLL_MS);
  }
  return false;
}
