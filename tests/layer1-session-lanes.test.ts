// Pure lane packing for the session column.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBarReservePx, computeLaneX, computeSessionLanes, computeTrackWidthPx } from "../webapp/layer1-session-lanes.ts";

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
