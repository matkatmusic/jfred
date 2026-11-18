import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInnerColumnCount, computeMarkerBoxLayout, formatEventTimeText, formatNewerCountText, formatOlderCountText } from "../engineV3/tui/engineV3_tui_marker_box_layout.ts";

const EVENT_COUNT = 7;
const INNER_COLUMN_COUNT = 3;

type ExpectedStep = { markedPosition: number; windowStart: number; newerCount: number; olderCount: number; leftShowsNow: boolean; rightShowsEarliest: boolean };

// [markedPosition, windowStart, newerCount, olderCount, leftShowsNow, rightShowsEarliest]
const STEPPING_RIGHT: ExpectedStep[] = [
    { markedPosition: 0, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
    { markedPosition: 1, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
    { markedPosition: 2, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
    { markedPosition: 3, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
    { markedPosition: 4, windowStart: 2, newerCount: 1, olderCount: 3, leftShowsNow: false, rightShowsEarliest: false },
    { markedPosition: 5, windowStart: 3, newerCount: 2, olderCount: 2, leftShowsNow: false, rightShowsEarliest: false },
    { markedPosition: 6, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
    { markedPosition: 7, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
];

const STEPPING_LEFT: ExpectedStep[] = [
    { markedPosition: 7, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
    { markedPosition: 6, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
    { markedPosition: 5, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
    { markedPosition: 4, windowStart: 4, newerCount: 3, olderCount: 0, leftShowsNow: false, rightShowsEarliest: true },
    { markedPosition: 3, windowStart: 3, newerCount: 2, olderCount: 2, leftShowsNow: false, rightShowsEarliest: false },
    { markedPosition: 2, windowStart: 2, newerCount: 1, olderCount: 3, leftShowsNow: false, rightShowsEarliest: false },
    { markedPosition: 1, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
    { markedPosition: 0, windowStart: 1, newerCount: 0, olderCount: 4, leftShowsNow: true, rightShowsEarliest: false },
];

function runSteps(steps: ExpectedStep[], firstPreviousWindowStart: number | undefined): void {
    let previousWindowStart = firstPreviousWindowStart;
    for (const step of steps) {
        const layout = computeMarkerBoxLayout(EVENT_COUNT, step.markedPosition, previousWindowStart, INNER_COLUMN_COUNT);
        assert.deepEqual(
            { markedPosition: step.markedPosition, windowStart: layout.windowStart, newerCount: layout.newerCount, olderCount: layout.olderCount, leftShowsNow: layout.leftShowsNow, rightShowsEarliest: layout.rightShowsEarliest },
            step,
        );
        previousWindowStart = layout.windowStart;
    }
}

test("test_stepping_right_from_now_to_earliest_scrolls_the_window_only_when_the_marker_leaves_it", () => {
    // Scenario: 7 events, 3 inner columns, the marker steps right from position 0 to position 7.
    // each step's window start, counts and sticky column words equal the approved table.
    runSteps(STEPPING_RIGHT, undefined);
});

test("test_stepping_left_from_earliest_to_now_scrolls_the_window_only_when_the_marker_leaves_it", () => {
    // Scenario: 7 events, 3 inner columns, the marker steps left from position 7 to position 0, starting with the window at 4.
    // each step's window start, counts and sticky column words equal the mirror table.
    runSteps(STEPPING_LEFT, 4);
});

test("test_inner_positions_are_the_consecutive_positions_from_the_window_start", () => {
    // Scenario: window start 2 with 3 inner columns shows positions 2, 3 and 4.
    const layout = computeMarkerBoxLayout(EVENT_COUNT, 4, 2, INNER_COLUMN_COUNT);
    assert.deepEqual(layout.innerPositions, [2, 3, 4]);
});

test("test_the_first_call_with_no_previous_window_start_scrolls_to_show_the_marker", () => {
    // Scenario: the marker starts at position 5 and there is no previous window start.
    const layout = computeMarkerBoxLayout(EVENT_COUNT, 5, undefined, INNER_COLUMN_COUNT);
    // the window starts at 3, so the marker is the last inner column.
    assert.equal(layout.windowStart, 3);
});

test("test_a_layout_called_again_with_its_own_window_start_keeps_that_window_start", () => {
    // Scenario: the component calls the layout with the window start that the wiring already computed.
    const first = computeMarkerBoxLayout(EVENT_COUNT, 5, 1, INNER_COLUMN_COUNT);
    const second = computeMarkerBoxLayout(EVENT_COUNT, 5, first.windowStart, INNER_COLUMN_COUNT);
    assert.deepEqual(second, first);
});

test("test_with_no_events_only_now_is_shown", () => {
    // Scenario: K = 0, the file has no event.
    const layout = computeMarkerBoxLayout(0, 0, undefined, INNER_COLUMN_COUNT);
    // no inner positions, no counts, the left column shows now.
    assert.deepEqual(layout, { windowStart: 1, innerPositions: [], newerCount: 0, olderCount: 0, leftShowsNow: true, rightShowsEarliest: true });
});

test("test_with_fewer_events_than_inner_columns_all_positions_show_and_the_window_does_not_scroll", () => {
    // Scenario: K = 2 events, 3 inner columns, the marker is at the Earliest position 2.
    const layout = computeMarkerBoxLayout(2, 2, 1, INNER_COLUMN_COUNT);
    // only position 1 is inner, the right column shows Earliest, nothing is off screen.
    assert.deepEqual(layout, { windowStart: 1, innerPositions: [1], newerCount: 0, olderCount: 0, leftShowsNow: true, rightShowsEarliest: true });
});

test("test_with_one_event_there_is_no_inner_column", () => {
    // Scenario: K = 1, the marker is at the Earliest position 1.
    const layout = computeMarkerBoxLayout(1, 1, undefined, INNER_COLUMN_COUNT);
    assert.deepEqual(layout, { windowStart: 1, innerPositions: [], newerCount: 0, olderCount: 0, leftShowsNow: true, rightShowsEarliest: true });
});

test("test_one_newer_event_and_one_older_event_use_the_singular_word", () => {
    // Scenario: the count texts for 0, 1 and 2.
    assert.deepEqual([0, 1, 2].map(formatNewerCountText), ["(0 newer events)", "(1 newer event)", "(2 newer events)"]);
    assert.deepEqual([0, 1, 2].map(formatOlderCountText), ["(0 older events)", "(1 older event)", "(2 older events)"]);
});

test("test_an_event_time_is_19_characters_of_local_time", () => {
    // Scenario: 2026-01-02 03:04:05 local time.
    const text = formatEventTimeText(new Date(2026, 0, 2, 3, 4, 5));
    assert.equal(text, "2026-01-02 03:04:05");
    assert.equal(text.length, 19);
});

test("test_the_inner_column_count_comes_from_the_box_width_and_the_fixed_widths", () => {
    // Scenario: 135 columns is the narrowest box for 3 inner columns (4 border and padding + 26 + 30 + 3 inner of 21 + 4 separators of 3).
    assert.equal(computeInnerColumnCount(135), 3);
    // one column less holds only 2.
    assert.equal(computeInnerColumnCount(134), 2);
    // a very narrow box still shows 1.
    assert.equal(computeInnerColumnCount(20), 1);
});
