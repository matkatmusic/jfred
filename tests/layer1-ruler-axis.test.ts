// Task 234 (spec S18): the floored-linear, capped ruler axis — distinct instants resolved to
// accumulated pixel offsets at 2.5 px/hour with a 16 px per-gap floor and a 120 px per-gap cap.
// The proportional band is therefore 6.4 h (16 / 2.5) to 48 h (120 / 2.5); every "in proportion"
// case below sits inside it.
//
// TWO ENTRY POINTS, deliberately: `resolveInstantOffsets` takes bare instants and keeps the 16 px
// heuristic — it is the layered graph's axis (src/viewer_api_layered.ts, task 239) and its
// behaviour is unchanged, which is why its tests below are untouched. `layOutNodeLadders` (task
// 251) takes what each BUBBLE must draw and measures the floor from it instead; those tests start
// at the second block. Expectations are hand-derived from the locked constants, never computed by
// calling the code under test.

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

// A LADDER below is the same shape as an instant list — makeInstantsAtHours doubles as its
// builder, since one bubble's ladder is just the moments that bubble draws, in draw order.

test("test_layOutNodeLadders_gives_two_nodes_of_one_bubble_at_one_instant_their_own_rows", () => {
    // Scenario: the reported defect. A commit and the file's mtime land on the SAME second, so both
    // nodes resolved to one offset and the hash label printed straight over "on disk".
    // Steps:
    // one bubble drawing two nodes at a single moment.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0])]);
    // the moment is still ONE tick — the ruler did not gain a second entry.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0]);
    // but the two nodes come back one full row apart, which is what stops the overprinting.
    assert.deepEqual(layout.ladderOffsetsPx, [[0, RULER_NODE_ROW_PIXELS]]);
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22]]);
});

test("test_layOutNodeLadders_charges_the_next_gap_for_the_rows_stacked_at_an_instant", () => {
    // Scenario: rows hang BELOW their instant, so the gap LEAVING it has to pay for them — else the
    // next instant's node is drawn on top of a row already in use.
    // Steps:
    // a bubble with two tied nodes, then a third node one hour later.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0, 1])]);
    // the gap is 2 rows = 44 px, not the hour's linear 2.5 px and not the 16 px heuristic.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 2 * RULER_NODE_ROW_PIXELS]);
    // so the third node lands exactly one row below the second: 0, 22, 44 — three clear rows.
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22, 44]]);
});

test("test_layOutNodeLadders_charges_nothing_for_a_tie_across_two_different_bubbles", () => {
    // Scenario: bubbles sit SIDE BY SIDE, so two of them drawing a node at the same moment is free
    // — only nodes inside one bubble have to stack. Measuring the tie globally would inflate the
    // ruler on every project where two files were committed together, which is most of them.
    // Steps:
    // two bubbles each drawing ONE node at the same moment, and a third bubble an hour later.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([0]), makeInstantsAtHours([1])]);
    // the shared moment demands a single row, so the gap is one row rather than two.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, RULER_NODE_ROW_PIXELS]);
    // and both bubbles' nodes sit on row 0 of that instant — neither was pushed down.
    assert.deepEqual(layout.ladderOffsetsPx, [[0], [0], [22]]);
});

test("test_layOutNodeLadders_replaces_the_16_px_heuristic_with_one_measured_node_row", () => {
    // Scenario: task 251 — a gap too short to render was floored at a guessed 16 px, which cleared
    // the 15 px dot but left its label nowhere to go. The floor is now the row a node actually
    // needs.
    // Steps:
    // two bubbles a minute apart, whose linear placement would be about 0.04 px.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([1 / 60])]);
    // the gap renders one node row, NOT the old heuristic.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, RULER_NODE_ROW_PIXELS]);
    assert.notEqual(RULER_NODE_ROW_PIXELS, RULER_MIN_GAP_PIXELS);
});

test("test_layOutNodeLadders_leaves_a_gap_already_wider_than_its_rows_in_proportion", () => {
    // Scenario: content may only ever push entries FURTHER apart. A gap with room to spare must
    // keep reading as elapsed time, or the axis stops being a time axis.
    // Steps:
    // two bubbles twelve hours apart — 30 px linear, comfortably past one 22 px row.
    const layout = layOutNodeLadders([makeInstantsAtHours([0]), makeInstantsAtHours([12])]);
    // the gap stays at its proportional 30 px, untouched by the floor.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 12 * RULER_PIXELS_PER_HOUR]);
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 30]);
});

test("test_layOutNodeLadders_lets_measured_rows_outrank_the_120_px_gap_cap", () => {
    // Scenario: the cap exists to fit a months-long history on one screen, but capping a gap whose
    // rows were already charged would clip those rows back off the axis — the squashing this task
    // fixes. Content wins; the cap bounds only the LINEAR term.
    // Steps:
    // a bubble stacking six nodes on one moment, then a node six weeks later.
    const layout = layOutNodeLadders([makeInstantsAtHours([0, 0, 0, 0, 0, 0, 6 * 7 * 24])]);
    // six rows need 132 px, so the gap exceeds the 120 px cap rather than being clamped to it.
    assert.equal(layout.ticks.at(-1)!.offsetPx, 6 * RULER_NODE_ROW_PIXELS);
    assert.ok(6 * RULER_NODE_ROW_PIXELS > RULER_GAP_CAP_PIXELS);
    // and the last node sits one row below the sixth stacked node (110), with nothing overprinted.
    assert.deepEqual(layout.ladderOffsetsPx, [[0, 22, 44, 66, 88, 110, 132]]);
});

test("test_layOutNodeLadders_counts_every_node_at_an_instant_across_all_bubbles", () => {
    // Scenario (task 275, the user's words): "(6) ... means there are six events that occurred at
    // that timestamp". An event is a NODE, wherever it is drawn — so bubbles sitting side by side
    // at one moment all count, which is exactly what the spacing floor deliberately does NOT do.
    // Steps:
    // three bubbles at one moment — one of them drawing TWO nodes there — plus a later moment.
    const layout = layOutNodeLadders([
        makeInstantsAtHours([0, 0, 12]),
        makeInstantsAtHours([0]),
        makeInstantsAtHours([0, 12]),
    ]);
    // the shared moment counts FOUR events (2 + 1 + 1) and the later one counts two.
    assert.deepEqual(layout.ticks.map((tick) => tick.eventCount), [4, 2]);
    // and that is emphatically not the number the ruler was spaced by: the gap leaving the shared
    // instant is TWO rows, the tallest single bubble's stack, not four.
    assert.deepEqual(layout.ticks.map((tick) => tick.offsetPx), [0, 2 * RULER_NODE_ROW_PIXELS]);
});

test("test_resolveInstantOffsets_counts_the_events_it_collapsed_into_each_position", () => {
    // Scenario: the layered graph's axis takes bare instants and de-duplicates them, so the count
    // has to be taken BEFORE that — otherwise every position would report one event.
    // Steps:
    // four instants of which three name the same moment.
    const positions = resolveInstantOffsets(makeInstantsAtHours([0, 8, 0, 0]));
    // the collapsed position reports all three, and the lone one reports itself.
    assert.deepEqual(positions.map((position) => position.eventCount), [3, 1]);
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
