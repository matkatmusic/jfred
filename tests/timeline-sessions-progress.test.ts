// timeline build-progress overlay thresholds, labels, fractions (timeline-sessions.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    LARGE_TIMELINE_ROW_COUNT,
    checkTimelineNeedsProgressOverlay,
    computeTimelineBuildProgressLabel,
    computeTimelineProgressFraction,
} from "../webapp/views/timeline-sessions.ts";

test("test_checkTimelineNeedsProgressOverlay_returns_true_at_or_above_threshold", () => {
    // Behavior: a row count at the large-timeline threshold triggers the overlay.  Steps: Given a row count exactly equal to LARGE_TIMELINE_ROW_COUNT (whatever it is tuned to), checkTimelineNeedsProgressOverlay should report true (overlay needed).
    assert.equal(checkTimelineNeedsProgressOverlay(LARGE_TIMELINE_ROW_COUNT), true);
    // And a count well above the threshold is also true.
    assert.equal(checkTimelineNeedsProgressOverlay(LARGE_TIMELINE_ROW_COUNT * 12), true);
});

test("test_checkTimelineNeedsProgressOverlay_returns_false_below_threshold", () => {
    // Behavior: a small timeline needs no overlay and no yielding.  Steps: Given a row count one below LARGE_TIMELINE_ROW_COUNT, checkTimelineNeedsProgressOverlay should report false.
    assert.equal(checkTimelineNeedsProgressOverlay(LARGE_TIMELINE_ROW_COUNT - 1), false);
    assert.equal(checkTimelineNeedsProgressOverlay(0), false);
});

test("test_computeTimelineBuildProgressLabel_reports_built_over_total_rows", () => {
    // Behavior: the overlay label reads "Building timeline… <built> / <total> rows".  Steps: Given 250 rows built of 1200 total, the label states both counts in that exact format.
    assert.equal(
        computeTimelineBuildProgressLabel(250, 1200),
        "Building timeline… 250 / 1200 rows",
    );
});

test("test_computeTimelineProgressFraction_is_ratio_of_built_to_total", () => {
    // Behavior: the bar fill fraction is built/total.  Steps: Given 300 built of 1200, the fraction is 0.25.
    assert.equal(computeTimelineProgressFraction(300, 1200), 0.25);
});

test("test_computeTimelineProgressFraction_guards_against_zero_total", () => {
    // Behavior: a zero total must not divide by zero; treat as fully built.  Steps: Given 0 built of 0 total, the fraction is 1 (a complete/empty build).
    assert.equal(computeTimelineProgressFraction(0, 0), 1);
});
