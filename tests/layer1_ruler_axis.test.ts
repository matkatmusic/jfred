// Task 234 (spec S18): the floored-linear, capped ruler axis — distinct instants resolved to
// accumulated pixel offsets at 2.5 px/hour with a 16 px per-gap floor and a 120 px per-gap cap.
// The proportional band is therefore 6.4 h (16 / 2.5) to 48 h (120 / 2.5); every "in proportion"
// case below sits inside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RULER_GAP_CAP_PIXELS,
    RULER_MIN_GAP_PIXELS,
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

test("test_resolveInstantOffsets_scales_an_eight_hour_gap_to_20_px", () => {
    // Scenario: an in-band gap renders in proportion — 8 hours at 2.5 px/hour, clear of both the
    // 16 px floor and the 120 px cap.
    // Steps:
    // two instants eight hours apart.
    const offsets = resolveOffsetsAtHours([0, 8]);
    // the earliest sits at 0 and the later at exactly 20 px.
    assert.deepEqual(offsets, [0, 8 * RULER_PIXELS_PER_HOUR]);
    assert.deepEqual(offsets, [0, 20]);
});

test("test_resolveInstantOffsets_caps_a_six_week_gap_at_120_px", () => {
    // Scenario: an over-cap gap is clamped, keeping a months-long history on one screen.
    // Steps:
    // two instants six weeks apart.
    const offsets = resolveOffsetsAtHours([0, 6 * 7 * 24]);
    // the gap renders at exactly the cap, not its linear 2520 px.
    assert.deepEqual(offsets, [0, RULER_GAP_CAP_PIXELS]);
    assert.deepEqual(offsets, [0, 120]);
});

test("test_resolveInstantOffsets_floors_a_one_minute_gap_at_16_px", () => {
    // Scenario: the reported defect — two instants a minute apart resolved to well under the
    // 15 px `.node` dot, so adjacent nodes overprinted. The floor is what keeps them apart.
    // Steps:
    // two instants one minute apart, whose linear placement would be about 0.04 px.
    const offsets = resolveOffsetsAtHours([0, 1 / 60]);
    // the gap renders at exactly the floor.
    assert.deepEqual(offsets, [0, RULER_MIN_GAP_PIXELS]);
    assert.deepEqual(offsets, [0, 16]);
});

test("test_resolveInstantOffsets_preserves_ascending_order_from_unsorted_input", () => {
    // Scenario: instants arrive from several sources (commits, disk mtimes) in no order; the
    // ruler must still read strictly ascending in both time and pixels.
    // Steps:
    // four instants supplied out of order, two gaps in band and one over the cap.
    const positions = resolveInstantOffsets(makeInstantsAtHours([200, 0, 8, 20]));
    // instants come back ascending, and offsets accumulate strictly upward.
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([0, 8, 20, 200]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20, 50, 170]);
});

test("test_resolveInstantOffsets_places_a_pre_first_commit_disk_orphan_at_zero", () => {
    // Scenario: S18 bounds — a disk orphan whose mtime predates the first commit legitimately
    // moves the ruler's start earlier, so IT becomes position 0.
    // Steps:
    // two commit instants plus an orphan mtime eight hours before the first commit.
    const commits = makeInstantsAtHours([0, 12]);
    const orphans = makeInstantsAtHours([-8]);
    const positions = resolveInstantOffsets([...commits, ...orphans]);
    // the orphan leads the ruler at 0 and the commits shift downstream of it.
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([-8, 0, 12]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20, 50]);
});

test("test_resolveInstantOffsets_collapses_duplicate_instants_to_one_position", () => {
    // Scenario: a commit instant and a disk mtime can name the same moment — one moment is one
    // position on the ruler.
    // Steps:
    // three instants of which two are the same moment.
    const positions = resolveInstantOffsets(makeInstantsAtHours([0, 8, 0]));
    // only two positions survive.
    assert.equal(positions.length, 2);
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20]);
});
