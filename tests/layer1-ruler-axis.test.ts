// The proportional band is 6.4-48 h; every "in proportion" case below sits inside it. Expectations are hand-derived, not computed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RULER_GAP_CAP_PIXELS,
    RULER_MIN_GAP_PIXELS,
    RULER_NODE_ROW_PIXELS,
    RULER_PIXELS_PER_HOUR,
    layOutNodeLadders,
    resolveInstantOffsets,
} from "../webapp/layer1-ruler-axis.ts";

const HOUR_MS = 60 * 60 * 1000;
const BASE_MS = Date.UTC(2026, 6, 25, 12, 0, 0);

// Hours from one base moment, so the tests read as gaps.
function makeInstantsAtHours(hourOffsets: number[]): Date[] {
    return hourOffsets.map((hours) => new Date(BASE_MS + hours * HOUR_MS));
}

function resolveOffsetsAtHours(hourOffsets: number[]): number[] {
    return resolveInstantOffsets(makeInstantsAtHours(hourOffsets)).map((position) => position.offsetPx);
}

test("test_resolveInstantOffsets_scales_an_eight_hour_gap_to_20_px", () => {
    // An in-band gap renders in proportion, clear of both the 16 px floor and the 120 px cap.
    const offsets = resolveOffsetsAtHours([0, 8]);
    assert.deepEqual(offsets, [0, 8 * RULER_PIXELS_PER_HOUR]);
    assert.deepEqual(offsets, [0, 20]);
});

test("test_resolveInstantOffsets_caps_a_six_week_gap_at_120_px", () => {
    // An over-cap gap is clamped, keeping a months-long history on one screen.
    const offsets = resolveOffsetsAtHours([0, 6 * 7 * 24]);
    assert.deepEqual(offsets, [0, RULER_GAP_CAP_PIXELS]);
    assert.deepEqual(offsets, [0, 120]);
});

test("test_resolveInstantOffsets_floors_a_one_minute_gap_at_16_px", () => {
    // The reported defect: a minute apart is ~0.04 px linear, well under the 15 px dot, so nodes overprinted.
    const offsets = resolveOffsetsAtHours([0, 1 / 60]);
    assert.deepEqual(offsets, [0, RULER_MIN_GAP_PIXELS]);
    assert.deepEqual(offsets, [0, 16]);
});

test("test_resolveInstantOffsets_preserves_ascending_order_from_unsorted_input", () => {
    // Instants arrive unordered from several sources; the ruler must read strictly ascending.
    const positions = resolveInstantOffsets(makeInstantsAtHours([200, 0, 8, 20]));
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([0, 8, 20, 200]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20, 50, 170]);
});

test("test_resolveInstantOffsets_places_a_pre_first_commit_disk_orphan_at_zero", () => {
    // S18 bounds: a disk orphan predating the first commit moves the ruler's start earlier, so it becomes position 0.
    const commits = makeInstantsAtHours([0, 12]);
    const orphans = makeInstantsAtHours([-8]);
    const positions = resolveInstantOffsets([...commits, ...orphans]);
    assert.deepEqual(
        positions.map((position) => position.instant.getTime()),
        makeInstantsAtHours([-8, 0, 12]).map((instant) => instant.getTime()),
    );
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20, 50]);
});

// A ladder is the same shape as an instant list, so makeInstantsAtHours doubles as its builder.

test("test_layOutNodeLadders_gives_two_nodes_of_one_bubble_at_one_instant_their_own_rows", () => {
    // Reported defect: a commit and mtime on the same second shared one offset, hiding the hash label.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0])]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0]);
    assert.deepEqual(layout.ladderOffsetsPx, [[0, RULER_NODE_ROW_PIXELS]]);
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22]]);
});

test("test_layOutNodeLadders_charges_the_next_gap_for_the_rows_stacked_at_an_instant", () => {
    // Rows hang below their instant, so the leaving gap pays for them.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0, 1])]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 2 * RULER_NODE_ROW_PIXELS]);
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22, 44]]);
});

test("test_layOutNodeLadders_charges_nothing_for_a_tie_across_two_different_bubbles", () => {
    // A global tie measure would inflate the ruler whenever two files share a commit.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([0]), makeInstantsAtHours([1])]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, RULER_NODE_ROW_PIXELS]);
    assert.deepEqual(layout.ladderOffsetsPx, [[0], [0], [22]]);
});

test("test_layOutNodeLadders_replaces_the_16_px_heuristic_with_one_measured_node_row", () => {
    // The old 16 px floor left no room for the label; now one node row.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([1 / 60])]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, RULER_NODE_ROW_PIXELS]);
    assert.notEqual(RULER_NODE_ROW_PIXELS, RULER_MIN_GAP_PIXELS);
});

test("test_layOutNodeLadders_leaves_a_gap_already_wider_than_its_rows_in_proportion", () => {
    // Content only pushes entries further apart; a gap with room to spare must still read as elapsed time.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([12])]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 12 * RULER_PIXELS_PER_HOUR]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 30]);
});

test("test_layOutNodeLadders_lets_measured_rows_outrank_the_120_px_gap_cap", () => {
    // Capping a charged gap would clip rows, so content wins; the cap bounds linear growth only.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0, 0, 0, 0, 0, 6 * 7 * 24])]);
    assert.equal(layout.ticks.at(-1)!.offsetPx, 6 * RULER_NODE_ROW_PIXELS);
    assert.ok(6 * RULER_NODE_ROW_PIXELS > RULER_GAP_CAP_PIXELS);
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22, 44, 66, 88, 110, 132]]);
});

test("test_layOutNodeLadders_counts_every_node_at_an_instant_across_all_bubbles", () => {
    // An event is a node wherever it is drawn, so side-by-side bubbles all count, unlike the spacing floor.
    const layout = layOutNodeLadders([
        makeInstantsAtHours([0, 0, 12]),
        makeInstantsAtHours([0]),
        makeInstantsAtHours([0, 12]),
    ]);
    assert.deepEqual(layout.ticks.map((tick) => tick.eventCount), [4, 2]);
    // Not the number the ruler was spaced by: the gap is the tallest single bubble's stack, two.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 2 * RULER_NODE_ROW_PIXELS]);
});

test("test_layOutNodeLadders_adds_extra_gap_pixels_after_the_charged_instant_only", () => {
    // Task 300: an expanded row's list height shifts everything BELOW its instant, nothing above.
    const instants = makeInstantsAtHours([0, 12, 24]);
    const layout = layOutNodeLadders([instants], new Map([[instants[1]!.getTime(), 40]]));
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 30, 100]);
});

test("test_resolveInstantOffsets_counts_the_events_it_collapsed_into_each_position", () => {
    // The count has to be taken BEFORE de-duplication, else every position would report one event.
    const positions = resolveInstantOffsets(makeInstantsAtHours([0, 8, 0, 0]));
    assert.deepEqual(positions.map((position) => position.eventCount), [3, 1]);
});

test("test_resolveInstantOffsets_collapses_duplicate_instants_to_one_position", () => {
    // A commit instant and a disk mtime can name the same moment; one moment is one position.
    const positions = resolveInstantOffsets(makeInstantsAtHours([0, 8, 0]));
    assert.equal(positions.length, 2);
    assert.deepEqual(positions.map((position) => position.offsetPx), [0, 20]);
});
