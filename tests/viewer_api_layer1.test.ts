// Server test for task 235 (spec S18): GET /api/layer1-view?dir=&repo=&ref= serves the Layer 1
// View — on-disk file state paired against a git tree, with every instant already resolved to its
// pixel offset. Reads NO JSONL, so the fixture is two UNRELATED temp roots: a plain folder with
// pinned mtimes and a real two-commit repo. Spawned-process pattern (viewer_server.ts listens at
// import time — precedent: tests/viewer_api_layered.test.ts).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
// 17400 (viewer_server.test.ts), 17900 (viewer_api_layered.test.ts) and 18400
// (viewer_api_ladder.test.ts) are taken — parallel test files must never collide.
const SCRATCH_PORT = 18900 + (process.pid % 500);

// Every instant in the fixture is STATED, never read from the clock, so the pixel offsets below
// are arithmetic on known inputs rather than on "now".
const FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
const SECOND_COMMIT_INSTANT = "2026-07-01T14:00:00Z";
const SHARED_FILE_MTIME = "2026-07-01T18:00:00Z";
const DISK_ONLY_FILE_MTIME = "2026-07-02T14:00:00Z";

// The ruler at 2.5 px/hr with a 24 px per-gap cap (task 234). The last gap is 20 hours — 50 px
// linear — so a run that dropped the cap would read 70 px here instead of 44.
const FIRST_COMMIT_PX = 0;
const SECOND_COMMIT_PX = 10;      // +4 h
const SHARED_FILE_PX = 20;        // +4 h
const DISK_ONLY_FILE_PX = 44;     // +20 h, capped to 24

// The wire form: Path serializes via toJSON to a string, Date to an ISO string.
type WireLayer1Instant = { instant: string; axisPx: number };
type WireLayer1View = {
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

// The project folder: shared.txt (also in the repo) and disk-only.txt (in neither commit), each
// with a pinned mtime. No .git here — Layer 1 pairs two independent roots by relative path.
function makeFixtureDiskFolder(): string {
    const diskDir = mkdtempSync(join(tmpdir(), "layer1-view-dir-"));
    writeFileSync(join(diskDir, "shared.txt"), "on disk\n");
    utimesSync(join(diskDir, "shared.txt"), new Date(SHARED_FILE_MTIME), new Date(SHARED_FILE_MTIME));
    writeFileSync(join(diskDir, "disk-only.txt"), "never committed\n");
    utimesSync(join(diskDir, "disk-only.txt"), new Date(DISK_ONLY_FILE_MTIME), new Date(DISK_ONLY_FILE_MTIME));
    return diskDir;
}

// The repo: one commit adding shared.txt AND repo-only.txt together (so repo-only.txt's only
// instant is that first commit), then one commit editing shared.txt alone.
function makeFixtureRepo(): string {
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

const diskDir = makeFixtureDiskFolder();
const repoDir = makeFixtureRepo();
let child: ChildProcess | undefined = undefined;

// parseServerArgs REQUIRES --projects-dir even though this route reads no JSONL; the disk fixture
// doubles as a harmless scan root.
function spawnViewerProcess(): ChildProcess {
    return spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", diskDir,
        "--port", String(SCRATCH_PORT),
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

// One server for every test in this file (node:test runs a file's tests sequentially), so the
// five requests below cost one boot rather than five.
before(async () => {
    child = spawnViewerProcess();
    await waitUntilListening(child);
});

after(() => {
    child?.kill();
});

function buildViewUrl(parameters: Record<string, string>): string {
    const query = new URLSearchParams(parameters).toString();
    return `http://127.0.0.1:${SCRATCH_PORT}/api/layer1-view?${query}`;
}

async function requestFixtureView(): Promise<WireLayer1View> {
    const response = await fetch(buildViewUrl({ dir: diskDir, repo: repoDir }));
    assert.equal(response.status, 200);
    return await response.json() as WireLayer1View;
}

test("test_layer1_view_endpoint_pairs_disk_files_against_the_repo_tree", async () => {
    // Scenario: the folder and the repo overlap on exactly one relative path.
    // Steps:
    // the endpoint answers 200 with the three S18 buckets.
    const view = await requestFixtureView();
    // `pairs` holds exactly the path present in BOTH roots.
    assert.deepEqual(view.pairs.map((pair) => pair.path), ["shared.txt"]);
    // `gitOrphans` holds exactly the repo path with no on-disk counterpart. Direction is
    // load-bearing (S18): assert the CONTENT, since a swapped pair of buckets has the same sizes.
    assert.deepEqual(view.gitOrphans.map((orphan) => orphan.path), ["repo-only.txt"]);
    // `diskOrphans` holds exactly the on-disk path with no repo entry.
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.path), ["disk-only.txt"]);
});

test("test_layer1_view_endpoint_places_every_pair_node_on_the_shared_ruler", async () => {
    // Scenario: the page emits --axis-px straight from the wire, so the endpoint owes a finished
    // offset per node — the S18 ruler accumulates and cannot be re-derived in the browser.
    const view = await requestFixtureView();
    const pair = view.pairs[0]!;
    // the pair's commit nodes are the two commits that touched it, oldest first.
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
    ]);
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [FIRST_COMMIT_PX, SECOND_COMMIT_PX]);
    // every commit node carries its hash, so the page can label the dot.
    assert.equal(pair.commits.filter((commit) => commit.hash.length === 40).length, 2);
    // the on-disk node — S18's final node — sits at the file's pinned mtime.
    assert.equal(pair.onDisk.instant, new Date(SHARED_FILE_MTIME).toISOString());
    assert.equal(pair.onDisk.axisPx, SHARED_FILE_PX);
});

test("test_layer1_view_endpoint_returns_the_ruler_ticks_ascending_with_the_gap_cap_applied", async () => {
    // Scenario: the ruler is the view's DISTINCT instants, ascending, resolved once globally.
    const view = await requestFixtureView();
    assert.deepEqual(view.ruler.map((position) => position.instant), [
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
        new Date(SHARED_FILE_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    // the last gap is 20 hours — 50 px linear — so 44 proves the 24 px cap survived the round trip.
    assert.deepEqual(view.ruler.map((position) => position.axisPx), [
        FIRST_COMMIT_PX, SECOND_COMMIT_PX, SHARED_FILE_PX, DISK_ONLY_FILE_PX,
    ]);
});

test("test_layer1_view_endpoint_places_each_orphan_row_at_its_own_instant", async () => {
    // Scenario: a bucket is a plain file list carrying each member's OWN timestamp (S18), so each
    // row is placed on its own.
    const view = await requestFixtureView();
    // a repo-only row has no mtime, so it is placed at its last touching commit — here the first
    // (and only) commit that added it.
    assert.equal(view.gitOrphans[0]!.instant, new Date(FIRST_COMMIT_INSTANT).toISOString());
    assert.equal(view.gitOrphans[0]!.axisPx, FIRST_COMMIT_PX);
    // a disk-only row is placed at its mtime.
    assert.equal(view.diskOrphans[0]!.instant, new Date(DISK_ONLY_FILE_MTIME).toISOString());
    assert.equal(view.diskOrphans[0]!.axisPx, DISK_ONLY_FILE_PX);
});

test("test_layer1_view_endpoint_rejects_a_ref_that_does_not_resolve", async () => {
    // Scenario: `ref` is typed into the header's box, so a bad one is a client error the page can
    // display — never a 500 and never a stack trace.
    const response = await fetch(buildViewUrl({ dir: diskDir, repo: repoDir, ref: "no-such-ref" }));
    assert.equal(response.status, 400);
    const body = await response.text();
    // the message names the offending ref...
    assert.ok(body.includes("no-such-ref"), body);
    // ...and carries no stack frame, so nothing internal leaks to the page.
    assert.ok(!body.includes("\n    at "), body);
});

test("test_layer1_view_endpoint_rejects_inputs_that_are_not_a_folder_and_a_repo", async () => {
    // Scenario: dir and repo arrive from paste-able text boxes, so each bad form is a 400.
    // a folder that is not on disk names itself in the error.
    const missingDir = join(tmpdir(), "layer1-view-definitely-not-here");
    const missingResponse = await fetch(buildViewUrl({ dir: missingDir, repo: repoDir }));
    assert.equal(missingResponse.status, 400);
    assert.ok((await missingResponse.text()).includes(missingDir));
    // an omitted dir param names the param.
    const omittedResponse = await fetch(buildViewUrl({ repo: repoDir }));
    assert.equal(omittedResponse.status, 400);
    assert.ok((await omittedResponse.text()).includes("dir"));
    // a repo path that is not a git repo fails at the git read, naming git.
    const notARepoResponse = await fetch(buildViewUrl({ dir: diskDir, repo: diskDir }));
    assert.equal(notARepoResponse.status, 400);
    assert.ok((await notARepoResponse.text()).includes("git"));
});
