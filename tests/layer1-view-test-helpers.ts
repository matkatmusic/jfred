// Shared fixture and server harness for the two GET /api/layer1-view test files (tasks 235 and
// 240, spec S18). ONE fixture and ONE ruler serve both: tests/viewer_api_layer1.test.ts asserts
// which paths land in which bucket and how bad input is rejected, while
// tests/viewer_api_layer1_placement.test.ts asserts the axisPx those same paths come back with.
// Extracted rather than copied, per plans/coding-requirements.md §3 — a helper duplicated across
// files becomes one shared helper. Each test file still spawns its OWN server on its OWN port: a
// live server cannot be shared across node:test files.
//
// The route reads NO JSONL, so the fixture is two UNRELATED temp roots: a plain folder with pinned
// mtimes and a real two-commit repo. Spawned-process pattern (viewer_server.ts listens at import
// time — precedent: tests/viewer_api_layered.test.ts).

import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

// Every instant in the fixture is STATED, never read from the clock, so the pixel offsets below
// are arithmetic on known inputs rather than on "now".
//
// early.txt's mtime is six weeks BEFORE the first commit: S18's "Ruler bounds" case — it pulls the
// ruler's start earlier, so IT is position 0 and every commit shifts downstream of it.
export const EARLY_DISK_ORPHAN_MTIME = "2026-05-20T10:00:00Z";
export const FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const SHARED_FILE_MTIME = "2026-07-01T18:00:00Z";
export const DISK_ONLY_FILE_MTIME = "2026-07-02T14:00:00Z";

// Task 238's UNRELATED fixture, kept separate from the overlapping one above because three test
// files depend on that one's exact instants and pixel ladder. Distinct instants per file so each
// bucket row proves it carries its OWN timestamp and neither bucket's ordering passes on a tie.
export const UNRELATED_FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const UNRELATED_SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const UNRELATED_FIRST_DISK_MTIME = "2026-07-02T09:00:00Z";
export const UNRELATED_SECOND_DISK_MTIME = "2026-07-02T12:00:00Z";

// The content-measured, capped ruler (task 234, re-floored by task 251), resolved over the WHOLE
// view — the five instants above, de-duplicated and ascending, each advancing by 2.5 px/hr capped
// at 120 px and then raised to whatever the earlier instant's stacked node rows need. Every instant
// here is drawn by at most ONE node of any single bubble, so each demands exactly one 22 px row and
// the content floor is a flat 22 px throughout. Derived by hand so the expectations cannot agree
// with a buggy resolver:
//
//   early.txt mtime       2026-05-20T10:00Z    —                                     0
//   first commit          2026-07-01T10:00Z    +1008 h → max(min(2520,120), 22)=120  120
//   second commit         2026-07-01T15:00Z    +5 h    → max(12.5, 22)         = 22  142
//   shared.txt mtime      2026-07-01T18:00Z    +3 h    → max(7.5,  22)         = 22  164
//   disk-only.txt mtime   2026-07-02T14:00Z    +20 h   → max(50,   22)         = 50  214
//
// The gaps deliberately exercise all three regimes: one over the cap (6 weeks), two under the
// content floor (5 h and 3 h — both below the 8.8 h that one row buys, which is why they render an
// equal 22 px each rather than 12.5 and 7.5), and one in proportion (20 h, which needs no help from
// the floor). Task 251 moved the two floored gaps from 16 px to 22 px, since a row a bubble must
// actually show is 22 px tall — the 16 px heuristic they used to take was a guess at the dot's
// height and left the label with nowhere to go. Both clamps ACCUMULATE per adjacent pair, so the
// last tick reads 214 rather than 120. Every value is exact in binary floating point, so comparing
// them with deepEqual is safe.
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
    ruler: WireLayer1Instant[];
};

// Run a git command in `repoDir` with a fixed identity. GIT_COMMITTER_DATE stamps the instant S18
// reads; the author date is pinned far away so an author-time read would be caught.
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

// Write one fixture file and pin its mtime, which is the only Layer-1 timestamp S18 reads.
function writeFileWithPinnedMtime(folder: string, name: string, contents: string, mtime: string): void {
    writeFileSync(join(folder, name), contents);
    utimesSync(join(folder, name), new Date(mtime), new Date(mtime));
}

// The project folder: shared.txt (also in the repo), disk-only.txt (in neither commit) and
// early.txt (in neither commit, and its mtime predates the repo's FIRST commit). No .git here —
// Layer 1 pairs two independent roots by relative path.
//
// early.txt's NAME is load-bearing: walkCurrentFileState sorts by relative path, so the disk walk
// yields disk-only.txt BEFORE early.txt while their instants run the other way. A diskOrphans
// bucket handed back in walk order rather than instant order therefore fails the placement test.
export function makeFixtureDiskFolder(): string {
    const diskDir = mkdtempSync(join(tmpdir(), "layer1-view-dir-"));
    writeFileWithPinnedMtime(diskDir, "shared.txt", "on disk\n", SHARED_FILE_MTIME);
    writeFileWithPinnedMtime(diskDir, "disk-only.txt", "never committed\n", DISK_ONLY_FILE_MTIME);
    writeFileWithPinnedMtime(diskDir, "early.txt", "predates the repo\n", EARLY_DISK_ORPHAN_MTIME);
    return diskDir;
}

// The repo: one commit adding shared.txt AND repo-only.txt together (so repo-only.txt's only
// instant is that first commit), then one commit editing shared.txt alone.
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

// Task 238's project folder: every relative path here is absent from makeUnrelatedFixtureRepo's
// tree, so pairing yields ZERO pairs and BOTH buckets are populated — S18's acceptance criterion.
export function makeUnrelatedFixtureDiskFolder(): string {
    const diskDir = mkdtempSync(join(tmpdir(), "layer1-unrelated-dir-"));
    writeFileWithPinnedMtime(diskDir, "notes.txt", "disk only\n", UNRELATED_FIRST_DISK_MTIME);
    writeFileWithPinnedMtime(diskDir, "todo.md", "disk only too\n", UNRELATED_SECOND_DISK_MTIME);
    return diskDir;
}

// Task 238's repo: every tracked path is absent from the folder above. Two commits of one file
// each, so the two gitOrphans rows carry DIFFERENT instants and the bucket's ascending order is
// actually exercised rather than resolved by a tie. docs/readme.md is nested on purpose — it
// proves the buckets list repo-relative paths rather than basenames.
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

// ONE root that is both the project folder and the repo, holding one tracked file plus a committed
// submodule whose inner repo has a file of its own. dir === repo is the case the S18 feedback came
// from (both header boxes pointed at RevEng/jfred), and it is the only coordinate system where a
// gitlink path and a disk-walk path name the same thing — so it is where submodule exclusion is
// observable end to end. The submodule is nested at vendor/lib rather than at the root so the
// exclusion is proven against a path CONTAINING A SEPARATOR (the real repo has external/tmux_lib).
// `protocol.file.allow=always` is mandatory: modern git refuses a local-path submodule clone.
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

// Signal readiness the way the server announces it: the "viewer listening" stdout line.
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

// One listening viewer for a whole test file (node:test runs a file's tests sequentially), so its
// requests cost one boot rather than one each.
export async function startFixtureViewer(diskDir: string, port: number): Promise<ChildProcess> {
    const started = spawnViewerProcess(diskDir, port);
    await waitUntilListening(started);
    return started;
}

export function buildViewUrl(port: number, parameters: Record<string, string>): string {
    const query = new URLSearchParams(parameters).toString();
    return `http://127.0.0.1:${port}/api/layer1-view?${query}`;
}

// The fixture's own view, already parsed — the request every test of both files starts from.
export async function requestFixtureView(port: number, diskDir: string, repoDir: string): Promise<WireLayer1View> {
    const response = await fetch(buildViewUrl(port, { dir: diskDir, repo: repoDir }));
    assert.equal(response.status, 200);
    return await response.json() as WireLayer1View;
}
