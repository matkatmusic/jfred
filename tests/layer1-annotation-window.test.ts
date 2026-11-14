// Task 382: pure placement of session records on the axis and the window around the viewport.

import { test } from "node:test";
import assert from "node:assert/strict";
import { /* ANNOTATION_MARGIN_PX, */ listPairSpans, listSessionSpans, listWindowPlacements, computeAnnotationPlacements, listSessionPixelSpansFromServer, listSessionPixelSpansFromPlacements, listConnectorPlacements } from "../webapp/layer1-components/session-column/layer1-annotation-window.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation, WireSessionSpan } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const TICKS: WireRulerTick[] = [
    { instant: "2026-06-01T10:00:00Z", axisPx: 20, eventCount: 1 },
    { instant: "2026-06-01T11:00:00Z", axisPx: 120, eventCount: 1 },
];

function buildRecord(id: string, instant: string, sessionId = "s1"): WireAnnotation {
    return { id, kind: WireRecordKind.user, instant, label: id, sessionId, sessionTitle: sessionId, sessionFile: `/x/${sessionId}.jsonl`, line: 1000 };
}

// not behavior: it only checks the value of the ANNOTATION_MARGIN_PX constant.
// test("test_the_margin_is_three_hundred_pixels", () => {
//     assert.equal(ANNOTATION_MARGIN_PX, 300);
// });

test("test_a_record_is_placed_at_its_axis_offset", () => {
    // Scenario: a record halfway between two ticks lands halfway between their offsets.
    const [placement] = computeAnnotationPlacements([buildRecord("a", "2026-06-01T10:30:00Z")], TICKS);
    assert.equal(placement!.axisPx, 70);
    assert.equal(placement!.stack, 0);
});

test("test_records_at_one_offset_stack_one_step_further_each", () => {
    // Scenario: two records share an instant, so the second sits one step right; a later record restarts at zero.
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z"),
        buildRecord("b", "2026-06-01T10:00:00Z"),
        buildRecord("c", "2026-06-01T10:00:00Z"),
        buildRecord("d", "2026-06-01T11:00:00Z"),
    ];
    assert.deepEqual(computeAnnotationPlacements(records, TICKS).map((placement) => placement.stack), [0, 1, 2, 0]);
});

test("test_empty_ticks_give_no_placements", () => {
    assert.deepEqual(computeAnnotationPlacements([buildRecord("a", "2026-06-01T10:30:00Z")], []), []);
});

test("test_the_window_keeps_only_placements_inside_its_bounds", () => {
    // Scenario: a window from 50 to 100 keeps only the middle of three records at 20, 70, 120.
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z"),
        buildRecord("b", "2026-06-01T10:30:00Z"),
        buildRecord("c", "2026-06-01T11:00:00Z"),
    ];
    const kept = listWindowPlacements(computeAnnotationPlacements(records, TICKS), 50, 100);
    assert.deepEqual(kept.map((placement) => placement.annotation.id), ["b"]);
});

test("test_a_pair_span_runs_from_the_first_to_the_last_record_of_the_pair", () => {
    // Pair p has three records, with another pair's record between its ends; lone pair r gets no span.
    const records = [
        { ...buildRecord("a", "2026-06-01T10:00:00Z"), pairId: "p" },
        { ...buildRecord("b", "2026-06-01T10:15:00Z"), pairId: "r" },
        { ...buildRecord("c", "2026-06-01T10:30:00Z"), pairId: "p" },
        { ...buildRecord("d", "2026-06-01T11:00:00Z"), pairId: "p" },
    ];
    const spans = listPairSpans(computeAnnotationPlacements(records, TICKS));
    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0]!.map((placement) => placement.annotation.id), ["a", "d"]);
});

test("test_records_at_one_offset_in_two_sessions_both_stack_zero", () => {
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z", "s1"),
        buildRecord("b", "2026-06-01T10:00:00Z", "s2"),
    ];
    assert.deepEqual(computeAnnotationPlacements(records, TICKS).map((placement) => placement.stack), [0, 0]);
});

test("test_stack_counts_per_session_when_another_session_sits_between", () => {
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z", "s1"),
        buildRecord("b", "2026-06-01T10:00:00Z", "s2"),
        buildRecord("c", "2026-06-01T10:00:00Z", "s1"),
    ];
    assert.deepEqual(computeAnnotationPlacements(records, TICKS).map((placement) => placement.stack), [0, 0, 1]);
});

test("test_a_session_span_runs_from_its_first_to_its_last_record_and_a_lone_record_is_a_zero_height_span", () => {
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z", "s1"),
        buildRecord("b", "2026-06-01T10:15:00Z", "s2"),
        buildRecord("c", "2026-06-01T11:00:00Z", "s1"),
    ];
    const spans = listSessionSpans(computeAnnotationPlacements(records, TICKS));
    assert.deepEqual(spans.map((span) => span.map((placement) => placement.annotation.id)), [["a", "c"], ["b", "b"]]);
});

test("test_the_window_bounds_are_inclusive", () => {
    const records = [buildRecord("a", "2026-06-01T10:00:00Z"), buildRecord("c", "2026-06-01T11:00:00Z")];
    assert.equal(listWindowPlacements(computeAnnotationPlacements(records, TICKS), 20, 120).length, 2);
});

function buildServerSpan(sessionId: string, first: string, last: string): WireSessionSpan {
    return { sessionId, first, last };
}

test("test_server_spans_become_pixel_spans_through_the_ruler_ticks", () => {
    // Scenario: a span from the first tick's instant to the last tick's instant gives those ticks' axisPx.
    const spans = [buildServerSpan("s1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z")];
    assert.deepEqual(listSessionPixelSpansFromServer(spans, TICKS), [{ sessionId: "s1", firstPx: 20, lastPx: 120 }]);
});

test("test_a_server_span_that_ends_before_the_first_tick_is_dropped", () => {
    // Scenario: the span ends one hour before the ruler starts, so it gets no pixel span.
    const spans = [buildServerSpan("s1", "2026-06-01T08:00:00Z", "2026-06-01T09:00:00Z")];
    assert.deepEqual(listSessionPixelSpansFromServer(spans, TICKS), []);
});

test("test_a_server_span_that_starts_after_the_last_tick_is_dropped", () => {
    // Scenario: the span starts one hour after the ruler ends, so it gets no pixel span.
    const spans = [buildServerSpan("s1", "2026-06-01T12:00:00Z", "2026-06-01T13:00:00Z")];
    assert.deepEqual(listSessionPixelSpansFromServer(spans, TICKS), []);
});

test("test_a_server_span_that_starts_before_the_ruler_is_clamped_to_the_first_tick", () => {
    // Scenario: the span starts before the ruler and ends at the middle; its first pixel is the first tick's axisPx.
    const spans = [buildServerSpan("s1", "2026-06-01T08:00:00Z", "2026-06-01T10:30:00Z")];
    assert.deepEqual(listSessionPixelSpansFromServer(spans, TICKS), [{ sessionId: "s1", firstPx: 20, lastPx: 70 }]);
});

test("test_placement_spans_become_pixel_spans_with_their_session_id", () => {
    // Scenario: a session's placement span turns into a pixel span with the session's id.
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z", "s1"),
        buildRecord("c", "2026-06-01T11:00:00Z", "s1"),
    ];
    const placementSpans = listSessionSpans(computeAnnotationPlacements(records, TICKS));
    assert.deepEqual(listSessionPixelSpansFromPlacements(placementSpans), [{ sessionId: "s1", firstPx: 20, lastPx: 120 }]);
});

test("test_a_connector_is_wanted_once_per_session_line_with_extra_dots_on_the_widest_dot", () => {
    // Scenario: s1 has three dots on one line and one dot on another line; s2 has one extra dot on the first line.
    const placements = [
        { annotation: buildRecord("a", "2026-06-01T10:00:00Z", "s1"), axisPx: 100, stack: 0 },
        { annotation: buildRecord("b", "2026-06-01T10:00:00Z", "s1"), axisPx: 100, stack: 1 },
        { annotation: buildRecord("c", "2026-06-01T10:00:00Z", "s1"), axisPx: 100, stack: 3 },
        { annotation: buildRecord("d", "2026-06-01T10:10:00Z", "s1"), axisPx: 114, stack: 0 },
        { annotation: buildRecord("e", "2026-06-01T10:00:00Z", "s2"), axisPx: 100, stack: 2 },
    ];
    // Expect exactly two connectors: the widest s1 dot on line 100 and the s2 dot on line 100.
    const connectors = listConnectorPlacements(placements);
    assert.deepEqual(connectors.map((placement) => [placement.annotation.id, placement.axisPx, placement.stack]), [["c", 100, 3], ["e", 100, 2]]);
});

test("test_no_connector_is_wanted_when_every_dot_is_in_its_lane_slot", () => {
    // Scenario: every dot has stack 0, so no dot sits right of its lane and no connector is wanted.
    const placements = [
        { annotation: buildRecord("a", "2026-06-01T10:00:00Z", "s1"), axisPx: 100, stack: 0 },
        { annotation: buildRecord("b", "2026-06-01T10:10:00Z", "s2"), axisPx: 114, stack: 0 },
    ];
    assert.deepEqual(listConnectorPlacements(placements), []);
});
