// The axisPx placement half of GET /api/layer1-view (spec S18); path and bad-input cases live in
// tests/viewer_api_layer1.test.ts. Task 234 unit-tests resolveInstantOffsets in isolation, so what
// this file proves is the WIRING from real fixture data through the endpoint.
//
// The expected pixels are the hand-derived ladder stated in the helper module — never recomputed
// here, which would make the test agree with any bug.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import {
    DISK_ONLY_FILE_MTIME,
    DISK_ONLY_FILE_PX,
    EARLY_DISK_ORPHAN_MTIME,
    EARLY_DISK_ORPHAN_PX,
    FIRST_COMMIT_INSTANT,
    FIRST_COMMIT_PX,
    SECOND_COMMIT_INSTANT,
    SECOND_COMMIT_PX,
    SHARED_FILE_MTIME,
    SHARED_FILE_PX,
    makeFixtureDiskFolder,
    makeFixtureRepo,
    requestFixtureView,
    startFixtureViewer,
} from "./layer1-view-test-helpers.ts";

// 17400, 17900, 18400 and 18900 are taken — parallel test files must never collide.
const SCRATCH_PORT = 19400 + (process.pid % 500);

const diskDir = makeFixtureDiskFolder();
const repoDir = makeFixtureRepo();
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

test("test_layer1_view_endpoint_places_every_pair_node_on_the_shared_ruler", async () => {
    // The page emits --axis-px straight from the wire, so the endpoint owes a finished offset per
    // node — the S18 ruler accumulates and cannot be re-derived in the browser.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    const pair = view.pairs[0]!;
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
    ]);
    // The first commit sits at 120, NOT 0: early.txt's mtime predates it, so the ruler's start
    // moved earlier and every commit shifted downstream by that opening capped gap.
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [FIRST_COMMIT_PX, SECOND_COMMIT_PX]);
    assert.equal(pair.commits.filter((commit) => commit.hash.length === 40).length, 2);
    // The on-disk node reads 142 + 22 because a 3-hour gap is under the CONTENT FLOOR and renders
    // a whole 22 px node row rather than its linear 7.5.
    assert.equal(pair.onDisk.instant, new Date(SHARED_FILE_MTIME).toISOString());
    assert.equal(pair.onDisk.axisPx, SHARED_FILE_PX);
});

test("test_layer1_view_endpoint_returns_the_ruler_ticks_ascending_with_the_gap_cap_applied", async () => {
    // The ruler is the view's distinct instants resolved once globally, so a disk orphan's mtime is
    // a tick like a commit instant is — and a bucket member can pull the view's start earlier.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    assert.deepEqual(view.ruler.map((position) => position.instant), [
        new Date(EARLY_DISK_ORPHAN_MTIME).toISOString(),
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
        new Date(SHARED_FILE_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    // Both clamps end to end: the opening 6-week gap caps at 120, the 5- and 3-hour gaps floor to
    // 22 each. The last tick reads 214 because clamps apply per ADJACENT PAIR and accumulate.
    assert.deepEqual(view.ruler.map((position) => position.axisPx), [
        EARLY_DISK_ORPHAN_PX, FIRST_COMMIT_PX, SECOND_COMMIT_PX, SHARED_FILE_PX, DISK_ONLY_FILE_PX,
    ]);
    // The first commit counts TWO, which proves eventCount spans bubbles rather than being a
    // per-bubble number.
    assert.deepEqual(view.ruler.map((position) => position.eventCount), [1, 2, 1, 1, 1]);
});

test("test_layer1_view_endpoint_places_each_orphan_bucket_row_at_its_own_instant", async () => {
    // The page places a bucket at its first row, so rows must arrive earliest-first. A repo-only
    // row has no mtime and is placed at its last touching commit.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    assert.equal(view.gitOrphans[0]!.instant, new Date(FIRST_COMMIT_INSTANT).toISOString());
    assert.equal(view.gitOrphans[0]!.axisPx, FIRST_COMMIT_PX);
    // rows[0] is the EARLIEST member even though the disk walk yields it second (path order).
    // ponytail: gitOrphans uses the same orderRowsByInstant helper, so one bucket proves both.
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.instant), [
        new Date(EARLY_DISK_ORPHAN_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.axisPx), [
        EARLY_DISK_ORPHAN_PX, DISK_ONLY_FILE_PX,
    ]);
});
