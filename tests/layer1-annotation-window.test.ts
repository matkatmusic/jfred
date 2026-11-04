// Task 382: pure placement of session records on the axis and the window around the viewport.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANNOTATION_MARGIN_PX, listPairSpans, listWindowPlacements, placeAnnotations } from "../webapp/layer1-annotation-window.ts";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const TICKS: WireRulerTick[] = [
    { instant: "2026-06-01T10:00:00Z", axisPx: 20, eventCount: 1 },
    { instant: "2026-06-01T11:00:00Z", axisPx: 120, eventCount: 1 },
];

function buildRecord(id: string, instant: string): WireAnnotation {
    return { id, kind: WireRecordKind.user, instant, label: id };
}

test("test_the_margin_is_three_hundred_pixels", () => {
    assert.equal(ANNOTATION_MARGIN_PX, 300);
});

test("test_a_record_is_placed_at_its_axis_offset", () => {
    // Scenario: a record halfway between two ticks lands halfway between their offsets.
    const [placement] = placeAnnotations([buildRecord("a", "2026-06-01T10:30:00Z")], TICKS);
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
    assert.deepEqual(placeAnnotations(records, TICKS).map((placement) => placement.stack), [0, 1, 2, 0]);
});

test("test_empty_ticks_give_no_placements", () => {
    assert.deepEqual(placeAnnotations([buildRecord("a", "2026-06-01T10:30:00Z")], []), []);
});

test("test_the_window_keeps_only_placements_inside_its_bounds", () => {
    // Scenario: a window from 50 to 100 keeps only the middle of three records at 20, 70, 120.
    const records = [
        buildRecord("a", "2026-06-01T10:00:00Z"),
        buildRecord("b", "2026-06-01T10:30:00Z"),
        buildRecord("c", "2026-06-01T11:00:00Z"),
    ];
    const kept = listWindowPlacements(placeAnnotations(records, TICKS), 50, 100);
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
    const spans = listPairSpans(placeAnnotations(records, TICKS));
    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0]!.map((placement) => placement.annotation.id), ["a", "d"]);
});

test("test_the_window_bounds_are_inclusive", () => {
    const records = [buildRecord("a", "2026-06-01T10:00:00Z"), buildRecord("c", "2026-06-01T11:00:00Z")];
    assert.equal(listWindowPlacements(placeAnnotations(records, TICKS), 20, 120).length, 2);
});
