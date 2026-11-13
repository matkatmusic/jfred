// Task 888 step 14: sort the kept dots, give each session its span, answer a range query.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Uuid } from "../src/structures/domain.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { Layer1WireAnnotation } from "../src/layer1_session_dots_types.ts";
import { computeSessionSpans, listDotsInRange, sortDotsByInstant } from "../src/layer1_session_dots_query.ts";

function buildDot(id: string, sessionId: string, instantIso: string): Layer1WireAnnotation {
    return {
        id: new Uuid(id),
        kind: WireRecordKind.user,
        instant: new Date(instantIso),
        label: id,
        sessionId: new Uuid(sessionId),
        sessionTitle: `title ${sessionId}`,
        sessionFile: `/x/${sessionId}.jsonl`,
        line: 1,
    };
}

function listIds(dots: readonly Layer1WireAnnotation[]): string[] {
    const ids: string[] = [];
    for (const dot of dots) {
        ids.push(dot.id.toString());
    }
    return ids;
}

test("test_sortDotsByInstant_orders_ascending_and_keeps_input_order_for_equal_instants", () => {
    // Three dots arrive out of order; two of them share one instant.
    const late = buildDot("late", "s1", "2026-06-01T03:00:00.000Z");
    const tieFirst = buildDot("tie-first", "s1", "2026-06-01T01:00:00.000Z");
    const tieSecond = buildDot("tie-second", "s2", "2026-06-01T01:00:00.000Z");
    // Sort them.
    const sorted = sortDotsByInstant([late, tieFirst, tieSecond]);
    // The earlier instants come first, and the tied dots keep the order they came in.
    assert.deepEqual(listIds(sorted), ["tie-first", "tie-second", "late"]);
});

test("test_computeSessionSpans_gives_each_session_its_first_and_last_instant", () => {
    // Session A has three dots and session B has one.
    const sortedDots = [
        buildDot("a1", "A", "2026-06-01T01:00:00.000Z"),
        buildDot("b1", "B", "2026-06-01T02:00:00.000Z"),
        buildDot("a2", "A", "2026-06-01T03:00:00.000Z"),
        buildDot("a3", "A", "2026-06-01T04:00:00.000Z"),
    ];
    // Compute the spans.
    const spans = computeSessionSpans(sortedDots);
    // Session A runs from its first dot to its last dot.
    assert.equal(spans.length, 2);
    assert.equal(spans[0]!.sessionId.toString(), "A");
    assert.equal(spans[0]!.first.toISOString(), "2026-06-01T01:00:00.000Z");
    assert.equal(spans[0]!.last.toISOString(), "2026-06-01T04:00:00.000Z");
    // Session B has one dot, so its first and last are the same.
    assert.equal(spans[1]!.sessionId.toString(), "B");
    assert.equal(spans[1]!.first.toISOString(), "2026-06-01T02:00:00.000Z");
    assert.equal(spans[1]!.last.toISOString(), "2026-06-01T02:00:00.000Z");
});

test("test_computeSessionSpans_orders_by_first_instant_then_session_id", () => {
    // Two sessions start at the same instant; the larger id comes first in the dot list.
    const sortedDots = [
        buildDot("z1", "zzz", "2026-06-01T01:00:00.000Z"),
        buildDot("a1", "aaa", "2026-06-01T01:00:00.000Z"),
    ];
    // Compute the spans.
    const spans = computeSessionSpans(sortedDots);
    // The smaller session id string comes first.
    assert.deepEqual([spans[0]!.sessionId.toString(), spans[1]!.sessionId.toString()], ["aaa", "zzz"]);
});

const RANGE_FROM = new Date("2026-06-01T02:00:00.000Z");
const RANGE_TO = new Date("2026-06-01T04:00:00.000Z");

test("test_listDotsInRange_includes_a_dot_exactly_at_from_and_exactly_at_to", () => {
    // Dots sit one hour before the range, on each bound, and one hour after.
    const sortedDots = [
        buildDot("before", "s", "2026-06-01T01:00:00.000Z"),
        buildDot("at-from", "s", "2026-06-01T02:00:00.000Z"),
        buildDot("at-to", "s", "2026-06-01T04:00:00.000Z"),
        buildDot("after", "s", "2026-06-01T05:00:00.000Z"),
    ];
    // Ask for the range.
    const found = listDotsInRange(sortedDots, RANGE_FROM, RANGE_TO);
    // Both bound dots are in the answer, and nothing else.
    assert.deepEqual(listIds(found), ["at-from", "at-to"]);
});

test("test_listDotsInRange_excludes_a_dot_one_millisecond_outside", () => {
    // One dot is 1 ms before from, one is 1 ms after to, one is inside.
    const sortedDots = [
        buildDot("just-before", "s", "2026-06-01T01:59:59.999Z"),
        buildDot("inside", "s", "2026-06-01T03:00:00.000Z"),
        buildDot("just-after", "s", "2026-06-01T04:00:00.001Z"),
    ];
    // Ask for the range.
    const found = listDotsInRange(sortedDots, RANGE_FROM, RANGE_TO);
    // Only the inside dot is in the answer.
    assert.deepEqual(listIds(found), ["inside"]);
});

test("test_listDotsInRange_keeps_every_dot_that_shares_an_instant_on_a_bound", () => {
    // Two dots share the from instant and two share the to instant.
    const sortedDots = [
        buildDot("from-1", "s", "2026-06-01T02:00:00.000Z"),
        buildDot("from-2", "s", "2026-06-01T02:00:00.000Z"),
        buildDot("to-1", "s", "2026-06-01T04:00:00.000Z"),
        buildDot("to-2", "s", "2026-06-01T04:00:00.000Z"),
    ];
    // Ask for the range.
    const found = listDotsInRange(sortedDots, RANGE_FROM, RANGE_TO);
    // All four are in the answer.
    assert.deepEqual(listIds(found), ["from-1", "from-2", "to-1", "to-2"]);
});

test("test_listDotsInRange_gives_nothing_when_from_is_after_to", () => {
    // A dot sits between the two bounds, but the bounds are swapped.
    const sortedDots = [buildDot("inside", "s", "2026-06-01T03:00:00.000Z")];
    // Ask with from after to.
    const found = listDotsInRange(sortedDots, RANGE_TO, RANGE_FROM);
    // The answer is empty.
    assert.deepEqual(found, []);
});

test("test_listDotsInRange_gives_nothing_for_an_empty_index", () => {
    // The index has no dots.
    const found = listDotsInRange([], RANGE_FROM, RANGE_TO);
    // The answer is empty.
    assert.deepEqual(found, []);
});
