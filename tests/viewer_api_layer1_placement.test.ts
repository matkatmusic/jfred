// Proves the WIRING from fixture data through the endpoint; expected pixels are hand-derived, never recomputed.

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
    // The page emits --axis-px straight from the wire, so the endpoint owes a finished offset per node.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    const pair = view.pairs[0]!;
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
    ]);
    // The first commit sits at 120, NOT 0, because early.txt's mtime moved the ruler's start earlier.
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [FIRST_COMMIT_PX, SECOND_COMMIT_PX]);
    assert.equal(pair.commits.filter((commit) => commit.hash.length === 40).length, 2);
    // The on-disk node reads 142 + 22 because a 3-hour gap falls under the CONTENT FLOOR.
    assert.equal(pair.onDisk.instant, new Date(SHARED_FILE_MTIME).toISOString());
    assert.equal(pair.onDisk.axisPx, SHARED_FILE_PX);
});

test("test_layer1_view_endpoint_returns_the_ruler_ticks_ascending_with_the_gap_cap_applied", async () => {
    // The ruler resolves all distinct instants globally, so a disk orphan's mtime is a tick too.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    assert.deepEqual(view.ruler.map((position) => position.instant), [
        new Date(EARLY_DISK_ORPHAN_MTIME).toISOString(),
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
        new Date(SHARED_FILE_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    // Both clamps end to end; the last tick reads 214 because clamps apply per ADJACENT PAIR.
    assert.deepEqual(view.ruler.map((position) => position.axisPx), [
        EARLY_DISK_ORPHAN_PX, FIRST_COMMIT_PX, SECOND_COMMIT_PX, SHARED_FILE_PX, DISK_ONLY_FILE_PX,
    ]);
    // The first commit counts TWO, which proves eventCount spans bubbles rather than being a per-bubble number.
    assert.deepEqual(view.ruler.map((position) => position.eventCount), [1, 2, 1, 1, 1]);
});

test("test_layer1_view_endpoint_places_each_orphan_bucket_row_at_its_own_instant", async () => {
    // The page places a bucket at its first row, so rows must arrive earliest-first.
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
