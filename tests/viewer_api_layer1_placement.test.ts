// Server test for task 240 (spec S18): the axisPx VERTICAL PLACEMENT half of
// GET /api/layer1-view, split out of tests/viewer_api_layer1.test.ts, which keeps the path and
// bad-input cases. Both files share one fixture via tests/layer1-view-test-helpers.ts and each
// spawns its own viewer process on its own port.
//
// Task 234 already unit-tests resolveInstantOffsets in ISOLATION (8-hour gap = 20 px, 6-week gap
// = 120 px, one-minute gap floored to 16 px, ordering, a pre-first-commit instant at 0, duplicate
// collapse), so nothing here restates the resolver. What this file proves is the WIRING from real
// fixture data through the endpoint — where a wrong anchor instant or an off-by-one lands, and
// where a resolver unit test cannot look:
//
//   (a) a disk orphan whose mtime PREDATES the first commit takes position 0 and shifts every
//       commit downstream (S18 "Ruler bounds");
//   (b) a MULTI-member bucket comes back ascending by instant, so rows[0] really is its earliest
//       member — the page places a bucket at rows[0].axisPx with no Math.min of its own;
//   (c) both locked clamp cases survive the round trip — the cap AND the floor — accumulating.
//
// The expected pixels are the hand-derived ladder stated in the helper module — never recomputed
// here by calling resolveInstantOffsets or re-implementing the 2.5 px/hr rule and its 16 px …
// 120 px band, which would make the test agree with any bug.
//
// The wire shape is FROZEN (user-confirmed 2026-07-25): every axisPx is ABSOLUTE and there is no
// per-pair widget offset, so "a pair widget sits at its FIRST commit" is pair.commits[0].axisPx by
// construction and needs no assertion. The widget-relative subtraction lives in the page and is
// covered by task 237's DOM test.

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

// 17400 (viewer_server.test.ts), 17900 (viewer_api_layered.test.ts), 18400
// (viewer_api_ladder.test.ts) and 18900 (viewer_api_layer1.test.ts) are taken — parallel test
// files must never collide.
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
    // Scenario: the page emits --axis-px straight from the wire, so the endpoint owes a finished
    // offset per node — the S18 ruler accumulates and cannot be re-derived in the browser.
    // Steps:
    // the endpoint answers with the fixture's single pair.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    const pair = view.pairs[0]!;
    // the pair's commit nodes are the two commits that touched it, oldest first.
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
    ]);
    // the first commit sits at 120, NOT 0 — early.txt's mtime predates it, so the ruler's start
    // moved earlier and every commit shifted downstream by that opening capped gap. A run that
    // anchored the ruler at the first commit rather than at the view's earliest instant would read
    // 0 here, and the second commit would read 22 instead of 142.
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [FIRST_COMMIT_PX, SECOND_COMMIT_PX]);
    // every commit node carries its hash, so the page can label the dot.
    assert.equal(pair.commits.filter((commit) => commit.hash.length === 40).length, 2);
    // the on-disk node — S18's final node — sits at the file's pinned mtime, three hours past the
    // second commit: 142 + 22, because a 3-hour gap is under the CONTENT FLOOR and so renders one
    // whole 22 px node row rather than its linear 7.5 — the task-251 clamp that gives this bubble's
    // "on disk" row somewhere to sit that its neighbouring hash row is not already using.
    assert.equal(pair.onDisk.instant, new Date(SHARED_FILE_MTIME).toISOString());
    assert.equal(pair.onDisk.axisPx, SHARED_FILE_PX);
});

test("test_layer1_view_endpoint_returns_the_ruler_ticks_ascending_with_the_gap_cap_applied", async () => {
    // Scenario: the ruler is the view's DISTINCT instants, ascending, resolved once globally — so
    // a disk orphan's mtime is a tick exactly like a commit instant is.
    // Steps:
    // the endpoint answers with the fixture's five distinct instants.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    // the earliest tick is the disk orphan, not the first commit: a bucket member pulls the whole
    // view's start earlier (S18 "Ruler bounds").
    assert.deepEqual(view.ruler.map((position) => position.instant), [
        new Date(EARLY_DISK_ORPHAN_MTIME).toISOString(),
        new Date(FIRST_COMMIT_INSTANT).toISOString(),
        new Date(SECOND_COMMIT_INSTANT).toISOString(),
        new Date(SHARED_FILE_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    // both locked clamps, end to end: the opening 6-week gap renders exactly 120 px rather than
    // its linear 2520, while the 5-hour and 3-hour gaps are both under the CONTENT FLOOR and so
    // render an equal 22 px each — one node row — rather than 12.5 and 7.5. The closing 20-hour gap
    // is in proportion at 50 and needs no floor, and the last tick reads 214 because the clamps
    // apply per ADJACENT PAIR and accumulate — a run that clamped the axis as a whole would read
    // 120 here.
    assert.deepEqual(view.ruler.map((position) => position.axisPx), [
        EARLY_DISK_ORPHAN_PX, FIRST_COMMIT_PX, SECOND_COMMIT_PX, SHARED_FILE_PX, DISK_ONLY_FILE_PX,
    ]);
});

test("test_layer1_view_endpoint_places_each_orphan_bucket_row_at_its_own_instant", async () => {
    // Scenario: a bucket is a plain file list carrying each member's OWN timestamp (S18), and the
    // page places the bucket at its first row, so the rows must arrive earliest-first.
    // Steps:
    // the endpoint answers with a one-member git bucket and a two-member disk bucket.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    // a repo-only row has no mtime, so it is placed at its last touching commit — here the first
    // (and only) commit that added it, which the pre-commit orphan has pushed to 120.
    assert.equal(view.gitOrphans[0]!.instant, new Date(FIRST_COMMIT_INSTANT).toISOString());
    assert.equal(view.gitOrphans[0]!.axisPx, FIRST_COMMIT_PX);
    // the disk bucket's two members are ascending by instant, so rows[0] is the EARLIEST member
    // even though the disk walk yields it second (path order: disk-only.txt before early.txt).
    // ponytail: gitOrphans is ordered by the same orderRowsByInstant helper, so one multi-member
    // bucket proves the ordering for both buckets.
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.instant), [
        new Date(EARLY_DISK_ORPHAN_MTIME).toISOString(),
        new Date(DISK_ONLY_FILE_MTIME).toISOString(),
    ]);
    // and each row carries its own place: the bucket spans the whole ruler, 0 to 214.
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.axisPx), [
        EARLY_DISK_ORPHAN_PX, DISK_ONLY_FILE_PX,
    ]);
});
