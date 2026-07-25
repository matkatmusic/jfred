// Task 234 (spec S18): the capped-gap ruler axis — distinct instants resolved to accumulated
// pixel offsets at 2.5 px/hour with a 24 px per-gap cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RULER_GAP_CAP_PIXELS,
    RULER_PIXELS_PER_HOUR,
    resolveInstantOffsets,
} from "../src/layer1_ruler_axis.ts";

const HOUR_MS = 60 * 60 * 1000;
const BASE_MS = Date.UTC(2026, 6, 25, 12, 0, 0);

// Build instants as offsets in hours from one base moment, so the tests read as gaps.
function makeInstantsAtHours(hourOffsets: number[]): Date[] {
    return hourOffsets.map((hours) => new Date(BASE_MS + hours * HOUR_MS));
}

// The resolved offsets alone — every assertion here is about pixel placement.
function resolveOffsetsAtHours(hourOffsets: number[]): number[] {
    return resolveInstantOffsets(makeInstantsAtHours(hourOffsets)).map((position) => position.offsetPx);
}

test("test_resolveInstantOffsets_scales_a_five_hour_gap_to_12_5_px", () => {
    // Scenario: a sub-cap gap renders in proportion — 5 hours at 2.5 px/hour.
    // Steps:
    // two instants five hours apart.
    const offsets = resolveOffsetsAtHours([0, 5]);
    // the earliest sits at 0 and the later at exactly 12.5 px.
    assert.deepEqual(offsets, [0, 5 * RULER_PIXELS_PER_HOUR]);
    assert.deepEqual(offsets, [0, 12.5]);
});

test("test_resolveInstantOffsets_caps_a_six_week_gap_at_24_px", () => {
    // Scenario: an over-cap gap is clamped, keeping a months-long history on one screen.
    // Steps:
    // two instants six weeks apart.
    const offsets = resolveOffsetsAtHours([0, 6 * 7 * 24]);
    // the gap renders at exactly the cap, not its linear 2520 px.
    assert.deepEqual(offsets, [0, RULER_GAP_CAP_PIXELS]);
    assert.deepEqual(offsets, [0, 24]);
});

test("test_resolveInstantOffsets_preserves_ascending_order_from_unsorted_input", () => {
    // Scenario: instants arrive from several sources (commits, disk mtimes) in no order; the
    // ruler must still read strictly ascending in both time and pixels.
    // Steps:
    // four instants supplied out of order, one gap over the cap.
    const positions = resolveInstantOffsets(makeInstantsAtHours([200, 0, 2, 6]));
    // instants come back ascending, and offsets accumulate strictly upward.
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([0, 2, 6, 200]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 5, 15, 39]);
});

test("test_resolveInstantOffsets_places_a_pre_first_commit_disk_orphan_at_zero", () => {
    // Scenario: S18 bounds — a disk orphan whose mtime predates the first commit legitimately
    // moves the ruler's start earlier, so IT becomes position 0.
    // Steps:
    // two commit instants plus an orphan mtime three hours before the first commit.
    const commits = makeInstantsAtHours([0, 4]);
    const orphans = makeInstantsAtHours([-3]);
    const positions = resolveInstantOffsets([...commits, ...orphans]);
    // the orphan leads the ruler at 0 and the commits shift downstream of it.
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([-3, 0, 4]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 7.5, 17.5]);
});

test("test_resolveInstantOffsets_collapses_duplicate_instants_to_one_position", () => {
    // Scenario: a commit instant and a disk mtime can name the same moment — one moment is one
    // position on the ruler.
    // Steps:
    // three instants of which two are the same moment.
    const positions = resolveInstantOffsets(makeInstantsAtHours([0, 4, 0]));
    // only two positions survive.
    assert.equal(positions.length, 2);
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 10]);
});
