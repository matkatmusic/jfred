// Pure lane packing for the session column.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BRACKET_OFFSET_PX, computeBarReservePx, computeLaneWidthSlots, computeLaneX, computeSessionLanes, computeTrackWidthPx } from "../webapp/layer1-components/session-column/layer1-session-lanes.ts";

test("test_spans_that_do_not_overlap_share_lane_zero", () => {
    const lanes = computeSessionLanes([
        { firstPx: 0, lastPx: 100 },
        { firstPx: 200, lastPx: 300 },
    ]);
    assert.deepEqual(lanes, [0, 0]);
});

test("test_overlapping_spans_take_the_next_lane", () => {
    const lanes = computeSessionLanes([
        { firstPx: 0, lastPx: 100 },
        { firstPx: 50, lastPx: 150 },
    ]);
    assert.deepEqual(lanes, [0, 1]);
});

test("test_a_gap_under_fourteen_pixels_counts_as_overlap", () => {
    const lanes = computeSessionLanes([
        { firstPx: 0, lastPx: 100 },
        { firstPx: 113, lastPx: 200 },
    ]);
    assert.deepEqual(lanes, [0, 1]);
});

test("test_a_gap_of_exactly_fourteen_pixels_shares_the_lane", () => {
    const lanes = computeSessionLanes([
        { firstPx: 0, lastPx: 100 },
        { firstPx: 114, lastPx: 200 },
    ]);
    assert.deepEqual(lanes, [0, 0]);
});

test("test_three_way_overlap_uses_three_lanes_and_a_later_span_reuses_lane_zero", () => {
    const lanes = computeSessionLanes([
        { firstPx: 0, lastPx: 100 },
        { firstPx: 30, lastPx: 120 },
        { firstPx: 60, lastPx: 90 },
        { firstPx: 300, lastPx: 400 },
    ]);
    assert.deepEqual(lanes, [0, 1, 2, 0]);
});

test("test_lanes_are_returned_in_input_order_even_when_input_is_unsorted", () => {
    const lanes = computeSessionLanes([
        { firstPx: 300, lastPx: 400 },
        { firstPx: 0, lastPx: 100 },
    ]);
    assert.deepEqual(lanes, [0, 0]);
});

test("test_bar_reserve_is_zero_for_no_picked_sessions_else_nine_each_plus_four", () => {
    assert.equal(computeBarReservePx(0), 0);
    assert.equal(computeBarReservePx(1), 13);
    assert.equal(computeBarReservePx(3), 31);
});

test("test_lane_x_adds_the_reserve_the_first_offset_and_the_lane_step", () => {
    assert.equal(computeLaneX(0, 0), 18);
    // assert.equal(computeLaneX(2, 0), 74);
    // assert.equal(computeLaneX(1, 13), 59);
    assert.equal(computeLaneX(2, 0), 52);
    assert.equal(computeLaneX(1, 13), 48);
});

test("test_three_lanes_with_no_picked_sessions_are_seventy_four_pixels_wide", () => {
    // assert.equal(computeTrackWidthPx(3, 0), 96);
    assert.equal(computeTrackWidthPx(3, 0), 74);
});

test("test_without_lane_widths_the_numbers_are_todays", () => {
    // No lane widths given: lane 2 is at 52 and three lanes are 74 wide.
    assert.equal(computeLaneX(2, 0), 52);
    assert.equal(computeTrackWidthPx(3, 0), 74);
});

test("test_each_lane_advances_by_step_plus_bracket_room_plus_extra_slots", () => {
    // Three one-slot lanes advance 17 + 8 = 25 each.
    assert.equal(computeLaneX(0, 0, [1, 1, 1]), 18);
    assert.equal(computeLaneX(1, 0, [1, 1, 1]), 43);
    assert.equal(computeLaneX(2, 0, [1, 1, 1]), 68);
    // A two-slot lane 0 pushes lane 1 by 17 + 8 + 14 = 39.
    assert.equal(computeLaneX(1, 0, [2, 1]), 57);
    // A bar reserve of 13 moves every lane right by 13.
    assert.equal(computeLaneX(0, 13, [1, 1, 1]), 31);
    assert.equal(computeLaneX(1, 13, [1, 1, 1]), 56);
    assert.equal(computeLaneX(2, 13, [1, 1, 1]), 81);
});

test("test_the_track_is_as_wide_as_the_last_lane_plus_its_extra_slots_plus_the_end_pad", () => {
    // Three one-slot lanes: last lane x 68 plus the 22px end pad.
    assert.equal(computeTrackWidthPx(3, 0, [1, 1, 1]), 90);
    // Last lane x 43 plus 2 extra slots of 14 plus the 22px end pad.
    assert.equal(computeTrackWidthPx(2, 0, [1, 3]), 93);
});

test("test_a_lane_bracket_is_clear_of_the_dots_of_the_lane_before", () => {
    const laneWidthSlots = [2, 1];
    // Lane 0 is two slots wide: its last dot is one stack step right of the lane x.
    const lastDotCenterX = computeLaneX(0, 0, laneWidthSlots) + 14;
    const lastDotRightEdgeX = lastDotCenterX + 7;
    // Lane 1 draws its bracket left of its own lane x.
    const nextBracketLeftX = computeLaneX(1, 0, laneWidthSlots) - BRACKET_OFFSET_PX;
    assert.ok(nextBracketLeftX - lastDotRightEdgeX >= 3);
});

test("test_computeLaneWidthSlots_takes_the_widest_session_of_each_lane", () => {
    // Lane 0 holds sessions 0 and 2 (widths 1 and 3); lane 1 holds session 1 (width 2).
    assert.deepEqual(computeLaneWidthSlots([0, 1, 0], [1, 2, 3]), [3, 2]);
    // Two one-slot sessions in one lane stay one slot.
    assert.deepEqual(computeLaneWidthSlots([0, 0], [1, 1]), [1]);
    // No sessions still gives one one-slot lane.
    assert.deepEqual(computeLaneWidthSlots([], []), [1]);
});
