// Shared fixture and viewer-server harness for the layer1-view test files.

import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

// Every instant is STATED, never read from the clock; early.txt predates the first commit, giving it ruler position 0.
export const EARLY_DISK_ORPHAN_MTIME = "2026-05-20T10:00:00Z";
export const FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const SHARED_FILE_MTIME = "2026-07-01T18:00:00Z";
export const DISK_ONLY_FILE_MTIME = "2026-07-02T14:00:00Z";

// Content-measured, capped ruler (2.5 px/hr, 120 cap, 22 floor) derived by hand so tests catch a buggy resolver.
export const EARLY_DISK_ORPHAN_PX = 0;
export const FIRST_COMMIT_PX = 120;
export const SECOND_COMMIT_PX = 142;
export const SHARED_FILE_PX = 164;
export const DISK_ONLY_FILE_PX = 214;

// The wire form: Path serializes via toJSON to a string, Date to an ISO string.
export type WireLayer1Instant = { instant: string; axisPx: number };
export type WireLayer1View = {
  pairs: Array<{ path: string; commits: Array<WireLayer1Instant & { hash: string }>; onDisk: WireLayer1Instant }>;
  gitOrphans: Array<WireLayer1Instant & { path: string }>;
  diskOrphans: Array<WireLayer1Instant & { path: string }>;
  // A ruler entry also carries a per-instant event count, which no NODE does.
  ruler: Array<WireLayer1Instant & { eventCount: number }>;
};

// GIT_COMMITTER_DATE stamps the instant S18 reads; author date is pinned away so an author-time read gets caught.
export function executeGitCommand(repoDir: string, command: string, committerDate?: string): void {
  execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
    cwd: repoDir,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      ...(committerDate === undefined ? {} : { GIT_COMMITTER_DATE: committerDate }),
    },
  });
}

// mtime is the only Layer-1 timestamp S18 reads.
export function writeFileWithPinnedMtime(folder: string, name: string, contents: string, mtime: string): void {
  writeFileSync(join(folder, name), contents);
  utimesSync(join(folder, name), new Date(mtime), new Date(mtime));
}

// early.txt's name is load-bearing: sorted walk order yields disk-only.txt first, opposite their instant order, catching wrong bucket placement.
export function createFixtureDiskFolder(): string {
  const diskDir = mkdtempSync(join(tmpdir(), "layer1-view-dir-"));
  writeFileWithPinnedMtime(diskDir, "shared.txt", "on disk\n", SHARED_FILE_MTIME);
  writeFileWithPinnedMtime(diskDir, "disk-only.txt", "never committed\n", DISK_ONLY_FILE_MTIME);
  writeFileWithPinnedMtime(diskDir, "early.txt", "predates the repo\n", EARLY_DISK_ORPHAN_MTIME);
  return diskDir;
}

// repo-only.txt ships in the first commit only, so its single instant is that commit.
export function createFixtureRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), "layer1-view-repo-"));
  executeGitCommand(repoDir, "init -q");
  writeFileSync(join(repoDir, "shared.txt"), "committed\n");
  writeFileSync(join(repoDir, "repo-only.txt"), "deleted from disk\n");
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m first", FIRST_COMMIT_INSTANT);
  writeFileSync(join(repoDir, "shared.txt"), "committed twice\n");
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m second", SECOND_COMMIT_INSTANT);
  return repoDir;
}

// parseServerArgs REQUIRES --projects-dir even though this route reads no JSONL; the disk fixture doubles as a harmless scan root.
function spawnViewerProcess(diskDir: string, port: number): ChildProcess {
  return spawn(process.execPath, [
    "--import", "tsx", "src/viewer_server.ts",
    "--projects-dir", diskDir,
    "--port", String(port),
  ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "inherit"] });
}

function markWhenListeningLineArrives(chunk: Buffer, markListening: () => void): void {
  const announcesListening = chunk.toString().includes("viewer listening");
  if (announcesListening) {
    markListening();
  }
}

function waitUntilListening(started: ChildProcess): Promise<void> {
  return new Promise((resolveStarted, rejectStarted) => {
    function readStdoutChunk(chunk: Buffer): void {
      markWhenListeningLineArrives(chunk, resolveStarted);
    }
    function reportEarlyExit(code: number | null): void {
      rejectStarted(new Error(`server exited early: ${code}`));
    }
    started.stdout?.on("data", readStdoutChunk);
    started.on("exit", reportEarlyExit);
  });
}

// One viewer per test file (node:test runs a file's tests sequentially) costs one boot, not one each.
export async function launchFixtureViewer(diskDir: string, port: number): Promise<ChildProcess> {
  const started = spawnViewerProcess(diskDir, port);
  await waitUntilListening(started);
  return started;
}

export function buildViewUrl(port: number, parameters: Record<string, string>): string {
  const query = new URLSearchParams(parameters).toString();
  return `http://127.0.0.1:${port}/api/layer1-view?${query}`;
}

export async function fetchFixtureView(port: number, diskDir: string, repoDir: string): Promise<WireLayer1View> {
  const response = await fetch(buildViewUrl(port, { dir: diskDir, repo: repoDir }));
  assert.equal(response.status, 200);
  return await response.json() as WireLayer1View;
}
