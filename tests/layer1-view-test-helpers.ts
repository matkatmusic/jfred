// Shared fixture and server harness for the two GET /api/layer1-view test files (spec S18). Each
// test file spawns its OWN server on its OWN port: a live server cannot be shared across
// node:test files. The route reads no JSONL, so the fixture is two unrelated temp roots.

import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

// Every instant is STATED, never read from the clock. early.txt's mtime sits six weeks BEFORE the
// first commit (S18's "Ruler bounds" case), so IT is position 0 and every commit shifts downstream.
export const EARLY_DISK_ORPHAN_MTIME = "2026-05-20T10:00:00Z";
export const FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const SHARED_FILE_MTIME = "2026-07-01T18:00:00Z";
export const DISK_ONLY_FILE_MTIME = "2026-07-02T14:00:00Z";

// Kept separate from the fixture above because three test files depend on that one's exact ladder;
// distinct instants per file so neither bucket's ordering can pass on a tie.
export const UNRELATED_FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const UNRELATED_SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const UNRELATED_FIRST_DISK_MTIME = "2026-07-02T09:00:00Z";
export const UNRELATED_SECOND_DISK_MTIME = "2026-07-02T12:00:00Z";

// The content-measured, capped ruler: 2.5 px/hr, capped at 120 px, floored at the 22 px one stacked
// node row needs. Derived by hand so the expectations cannot agree with a buggy resolver:
//
//   early.txt mtime       2026-05-20T10:00Z    —                                     0
//   first commit          2026-07-01T10:00Z    +1008 h → max(min(2520,120), 22)=120  120
//   second commit         2026-07-01T15:00Z    +5 h    → max(12.5, 22)         = 22  142
//   shared.txt mtime      2026-07-01T18:00Z    +3 h    → max(7.5,  22)         = 22  164
//   disk-only.txt mtime   2026-07-02T14:00Z    +20 h   → max(50,   22)         = 50  214
//
// The gaps exercise all three regimes: over the cap (6 weeks), under the floor (5 h and 3 h), and
// in proportion (20 h). Both clamps ACCUMULATE per adjacent pair, so the last tick reads 214.
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

// GIT_COMMITTER_DATE stamps the instant S18 reads; the author date is pinned far away so an
// author-time read would be caught.
function runGit(repoDir: string, command: string, committerDate?: string): void {
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
function writeFileWithPinnedMtime(folder: string, name: string, contents: string, mtime: string): void {
    writeFileSync(join(folder, name), contents);
    utimesSync(join(folder, name), new Date(mtime), new Date(mtime));
}

// early.txt's NAME is load-bearing: the walk sorts by relative path, so it yields disk-only.txt
// first while their instants run the other way — a bucket in walk order fails the placement test.
export function makeFixtureDiskFolder(): string {
    const diskDir = mkdtempSync(join(tmpdir(), "layer1-view-dir-"));
    writeFileWithPinnedMtime(diskDir, "shared.txt", "on disk\n", SHARED_FILE_MTIME);
    writeFileWithPinnedMtime(diskDir, "disk-only.txt", "never committed\n", DISK_ONLY_FILE_MTIME);
    writeFileWithPinnedMtime(diskDir, "early.txt", "predates the repo\n", EARLY_DISK_ORPHAN_MTIME);
    return diskDir;
}

// repo-only.txt ships in the first commit only, so its single instant is that commit.
export function makeFixtureRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-view-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, "shared.txt"), "committed\n");
    writeFileSync(join(repoDir, "repo-only.txt"), "deleted from disk\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first", FIRST_COMMIT_INSTANT);
    writeFileSync(join(repoDir, "shared.txt"), "committed twice\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m second", SECOND_COMMIT_INSTANT);
    return repoDir;
}

// Every path here is absent from makeUnrelatedFixtureRepo, so pairing yields ZERO pairs and BOTH
// buckets are populated — S18's acceptance criterion.
export function makeUnrelatedFixtureDiskFolder(): string {
    const diskDir = mkdtempSync(join(tmpdir(), "layer1-unrelated-dir-"));
    writeFileWithPinnedMtime(diskDir, "notes.txt", "disk only\n", UNRELATED_FIRST_DISK_MTIME);
    writeFileWithPinnedMtime(diskDir, "todo.md", "disk only too\n", UNRELATED_SECOND_DISK_MTIME);
    return diskDir;
}

// Two commits of one file each so the gitOrphans order is exercised rather than resolved by a tie;
// docs/readme.md is nested to prove the buckets list repo-relative paths, not basenames.
export function makeUnrelatedFixtureRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-unrelated-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, "alpha.py"), "print('repo only')\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first", UNRELATED_FIRST_COMMIT_INSTANT);
    mkdirSync(join(repoDir, "docs"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "readme.md"), "repo only too\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m second", UNRELATED_SECOND_COMMIT_INSTANT);
    return repoDir;
}

// dir === repo is the only coordinate system where a gitlink path and a disk-walk path name the
// same thing, so submodule exclusion is observable here; the nested folder proves it for a path
// containing a separator. `protocol.file.allow=always` is mandatory: git refuses a local-path clone.
export const SUBMODULE_FIXTURE_FOLDER = "vendor/lib";

export function makeSubmoduleFixtureRoot(): string {
    const innerDir = mkdtempSync(join(tmpdir(), "layer1-submodule-inner-"));
    runGit(innerDir, "init -q");
    writeFileSync(join(innerDir, "inner.txt"), "belongs to another repository\n");
    runGit(innerDir, "add -A");
    runGit(innerDir, "commit -q -m inner", UNRELATED_FIRST_COMMIT_INSTANT);
    const rootDir = mkdtempSync(join(tmpdir(), "layer1-submodule-root-"));
    runGit(rootDir, "init -q");
    writeFileSync(join(rootDir, "kept.txt"), "tracked here\n");
    runGit(rootDir, "add -A");
    runGit(rootDir, "commit -q -m one", UNRELATED_FIRST_COMMIT_INSTANT);
    runGit(rootDir, `-c protocol.file.allow=always submodule add -q ${innerDir} ${SUBMODULE_FIXTURE_FOLDER}`);
    runGit(rootDir, "add -A");
    runGit(rootDir, "commit -q -m submodule", UNRELATED_SECOND_COMMIT_INSTANT);
    return rootDir;
}

// parseServerArgs REQUIRES --projects-dir even though this route reads no JSONL; the disk fixture
// doubles as a harmless scan root.
function spawnViewerProcess(diskDir: string, port: number): ChildProcess {
    return spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", diskDir,
        "--port", String(port),
    ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "inherit"] });
}

function markWhenListeningLineArrives(chunk: Buffer, markListening: () => void): void {
    if (chunk.toString().includes("viewer listening")) {
        markListening();
    }
}

function waitUntilListening(started: ChildProcess): Promise<void> {
    return new Promise((resolveStarted, rejectStarted) => {
        started.stdout?.on("data", (chunk: Buffer) => markWhenListeningLineArrives(chunk, resolveStarted));
        started.on("exit", (code) => rejectStarted(new Error(`server exited early: ${code}`)));
    });
}

// One viewer per test file (node:test runs a file's tests sequentially) costs one boot, not one each.
export async function startFixtureViewer(diskDir: string, port: number): Promise<ChildProcess> {
    const started = spawnViewerProcess(diskDir, port);
    await waitUntilListening(started);
    return started;
}

export function buildViewUrl(port: number, parameters: Record<string, string>): string {
    const query = new URLSearchParams(parameters).toString();
    return `http://127.0.0.1:${port}/api/layer1-view?${query}`;
}

export async function requestFixtureView(port: number, diskDir: string, repoDir: string): Promise<WireLayer1View> {
    const response = await fetch(buildViewUrl(port, { dir: diskDir, repo: repoDir }));
    assert.equal(response.status, 200);
    return await response.json() as WireLayer1View;
}
