// Row block counting: how many dot lines each ruler row needs. Expectations are hand-derived.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SESSION_DOT_PX,
    computeDotBlockPxByTick,
    // task 912: computeSessionWidthSlots is commented out in the source.
    // computeSessionWidthSlots,
    countInstantsBefore,
    listDistinctInstants,
    type SessionDotInstants,
} from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";

function buildInstants(sessionDots: [string, number[]][]): SessionDotInstants {
    return new Map<string, readonly number[]>(sessionDots);
}

test("test_countInstantsBefore_returns_the_number_of_instants_before_the_limit", () => {
    // Steps: three limits over [10, 20, 20, 30]; equal instants are all counted or all left out.
    const sortedMs = [10, 20, 20, 30];
    // The limit 20 is not "before" itself, so only 10 counts.
    assert.equal(countInstantsBefore(sortedMs, 20), 1);
    // The limit 21 is after both 20s.
    assert.equal(countInstantsBefore(sortedMs, 21), 3);
    // The limit 99 is after everything.
    assert.equal(countInstantsBefore(sortedMs, 99), 4);
});

test("test_block_height_is_the_busiest_sessions_dot_count_times_the_dot_height", () => {
    // Steps: session A has 3 dots and session B has 1 dot in the row of tick 100.
    const instants = buildInstants([["a", [110, 120, 130]], ["b", [150]]]);
    // Compute the blocks for three ticks.
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200, 300]);
    // The row height follows A (3 dots), not B and not A plus B.
    assert.equal(blockPxByTick.get(100), 3 * SESSION_DOT_PX);
});

test("test_dots_at_one_instant_share_one_line", () => {
    // Steps: session A has 3 dots at the same millisecond.
    const instants = buildInstants([["a", [110, 110, 110]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200]);
    // The equal-instant dots sit side by side on one line, so 1 line.
    assert.equal(blockPxByTick.get(100), 1 * SESSION_DOT_PX);
});

test("test_block_height_counts_distinct_instants_of_the_busiest_session", () => {
    // Steps: session A has 2 distinct instants (3 dots); session B has 3 distinct instants.
    const instants = buildInstants([["a", [110, 110, 120]], ["b", [130, 140, 150]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200]);
    // The row height follows B, the session with 3 distinct instants.
    assert.equal(blockPxByTick.get(100), 3 * SESSION_DOT_PX);
    // Session A alone has 4 dots but only 2 distinct instants.
    const onlyA = buildInstants([["a", [110, 110, 110, 120]]]);
    const blockPxByTickForA = computeDotBlockPxByTick(onlyA, [100, 200]);
    // The row height is 2 lines, not 4.
    assert.equal(blockPxByTickForA.get(100), 2 * SESSION_DOT_PX);
});

test("test_listDistinctInstants_drops_repeats", () => {
    // Steps: give a sorted list with repeats.
    const distinctMs = listDistinctInstants([10, 20, 20, 30, 30, 30]);
    // Each instant stays once.
    assert.deepEqual(distinctMs, [10, 20, 30]);
    // An empty list stays empty.
    assert.deepEqual(listDistinctInstants([]), []);
});

// task 912: computeSessionWidthSlots is commented out in the source, so its test is off.
// test("test_computeSessionWidthSlots_is_the_biggest_same_instant_group", () => {
//     // Steps: three lists with different biggest groups.
//     // The biggest group is the three dots at 20.
//     assert.equal(computeSessionWidthSlots([10, 20, 20, 20, 30, 30]), 3);
//     // No repeats: every group has one dot.
//     assert.equal(computeSessionWidthSlots([10, 20]), 1);
//     // No dots: the lane still needs one slot.
//     assert.equal(computeSessionWidthSlots([]), 1);
// });

test("test_a_dot_exactly_on_a_tick_belongs_to_that_tick", () => {
    // Steps: one dot at ms 100, which is also the middle tick.
    const instants = buildInstants([["a", [100]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [50, 100, 200]);
    // The row of tick 100 owns it.
    assert.equal(blockPxByTick.get(100), SESSION_DOT_PX);
    // The row before does not.
    assert.equal(blockPxByTick.get(50), 0);
});

test("test_dots_before_the_first_tick_count_in_the_first_row", () => {
    // Steps: one dot at ms 10, before the first tick at 100.
    const instants = buildInstants([["a", [10]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200]);
    // The first row takes it.
    assert.equal(blockPxByTick.get(100), SESSION_DOT_PX);
    assert.equal(blockPxByTick.get(200), 0);
});

test("test_dots_after_the_last_tick_count_in_the_last_row", () => {
    // Steps: one dot at ms 500, after the last tick at 200.
    const instants = buildInstants([["a", [500]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200]);
    // The last row takes it.
    assert.equal(blockPxByTick.get(200), SESSION_DOT_PX);
    assert.equal(blockPxByTick.get(100), 0);
});

test("test_a_row_with_no_dots_has_height_zero", () => {
    // Steps: one dot in the first row; the middle row (tick 200) has none.
    const instants = buildInstants([["a", [110]]]);
    const blockPxByTick = computeDotBlockPxByTick(instants, [100, 200, 300]);
    // The empty row has height 0.
    assert.equal(blockPxByTick.get(200), 0);
});
