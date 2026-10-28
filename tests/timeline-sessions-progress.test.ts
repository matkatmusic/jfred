// timeline build-progress overlay thresholds, labels, fractions (timeline-build-progress.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    LARGE_TIMELINE_ROW_COUNT,
    isTimelineNeedingProgressOverlay,
    computeTimelineBuildProgressLabel,
    computeTimelineProgressFraction,
} from "../webapp/views/timeline-build-progress.ts";

test("test_isTimelineNeedingProgressOverlay_returns_true_at_or_above_threshold", () => {
    // Behavior: a row count at LARGE_TIMELINE_ROW_COUNT triggers the overlay.
    assert.equal(isTimelineNeedingProgressOverlay(LARGE_TIMELINE_ROW_COUNT), true);
    // And a count well above the threshold is also true.
    assert.equal(isTimelineNeedingProgressOverlay(LARGE_TIMELINE_ROW_COUNT * 12), true);
});

test("test_isTimelineNeedingProgressOverlay_returns_false_below_threshold", () => {
    // Behavior: a row count one below LARGE_TIMELINE_ROW_COUNT needs no overlay.
    assert.equal(isTimelineNeedingProgressOverlay(LARGE_TIMELINE_ROW_COUNT - 1), false);
    assert.equal(isTimelineNeedingProgressOverlay(0), false);
});

test("test_computeTimelineBuildProgressLabel_reports_built_over_total_rows", () => {
    // Behavior: 250 rows built of 1200 total reads "Building timeline… 250 / 1200 rows".
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
    // Behavior: 0 built of 0 total gives fraction 1, never a divide by zero.
    assert.equal(computeTimelineProgressFraction(0, 0), 1);
});
