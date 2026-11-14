// Task 907: session placement puts each dot at its row's top plus its line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSessionDotPlacements, listSessionPixelSpansFromInstants } from "../webapp/layer1-components/session-column/layer1-session-dot-placement.ts";
import { SESSION_DOT_PX } from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";
import type { SessionDotInstants } from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";
import type { Placement } from "../webapp/layer1-components/session-column/layer1-annotation-window.ts";
import type { WireAnnotation, WireSessionSpan } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const BASE_MS = Date.UTC(2026, 5, 1);
const ROW_MS = 60000;

function buildTicks(): WireRulerTick[] {
    return [
        { instant: new Date(BASE_MS).toISOString(), axisPx: 100, eventCount: 0, dotBlockPx: 28 },
        { instant: new Date(BASE_MS + ROW_MS).toISOString(), axisPx: 300, eventCount: 0, dotBlockPx: 28 },
        { instant: new Date(BASE_MS + 2 * ROW_MS).toISOString(), axisPx: 500, eventCount: 0, dotBlockPx: 28 },
    ];
}

function buildDot(sessionId: string, offsetMs: number, line: number): WireAnnotation {
    return { id: `${sessionId}-${line}`, kind: "user", instant: new Date(BASE_MS + offsetMs).toISOString(), label: "dot", sessionId, sessionTitle: "title", sessionFile: "s.jsonl", line };
}

test("test_the_first_dot_of_a_session_sits_level_with_its_row", () => {
    // one session with one dot inside row 1
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000]]]);
    const placements = computeSessionDotPlacements([buildDot("a", 1000, 1)], buildTicks(), instants);
    // the dot is level with tick 1
    assert.equal(placements[0]!.axisPx, 100);
});

test("test_the_next_dot_of_the_same_session_is_one_dot_lower", () => {
    // one session with two dots inside row 1
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 2000]]]);
    const placements = computeSessionDotPlacements([buildDot("a", 1000, 1), buildDot("a", 2000, 2)], buildTicks(), instants);
    // the second dot is one dot height under the tick
    assert.equal(placements[1]!.axisPx, 100 + SESSION_DOT_PX);
});

test("test_two_sessions_start_on_the_same_line_of_a_row", () => {
    // sessions a and b each have one dot in row 1
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000]], ["b", [BASE_MS + 1000]]]);
    const placements = computeSessionDotPlacements([buildDot("a", 1000, 1), buildDot("b", 1000, 2)], buildTicks(), instants);
    // both dots are level with tick 1
    assert.equal(placements[0]!.axisPx, 100);
    assert.equal(placements[1]!.axisPx, 100);
});

test("test_the_dot_count_restarts_in_the_next_row", () => {
    // session a has two dots in row 1 and one in row 2
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 2000, BASE_MS + ROW_MS + 1000]]]);
    const list = [buildDot("a", 1000, 1), buildDot("a", 2000, 2), buildDot("a", ROW_MS + 1000, 3)];
    const placements = computeSessionDotPlacements(list, buildTicks(), instants);
    // the dot in row 2 is level with tick 2
    assert.equal(placements[2]!.axisPx, 300);
});

test("test_dots_at_one_instant_of_one_session_sit_on_one_row_side_by_side_in_file_line_order", () => {
    // session a has two dots at one instant; line 9 is listed before line 3
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 1000]]]);
    const placements = computeSessionDotPlacements([buildDot("a", 1000, 9), buildDot("a", 1000, 3)], buildTicks(), instants);
    // line 3 comes first and line 9 sits beside it on the same row
    assert.equal(placements[0]!.annotation.line, 3);
    assert.equal(placements[0]!.axisPx, 100);
    assert.equal(placements[0]!.stack, 0);
    assert.equal(placements[1]!.annotation.line, 9);
    assert.equal(placements[1]!.axisPx, 100);
    assert.equal(placements[1]!.stack, 1);
});

test("test_a_dot_before_the_first_tick_goes_in_the_first_row", () => {
    // session a has one dot before tick 1
    const instants: SessionDotInstants = new Map([["a", [BASE_MS - 5000]]]);
    const placements = computeSessionDotPlacements([buildDot("a", -5000, 1)], buildTicks(), instants);
    // the dot is level with tick 1
    assert.equal(placements[0]!.axisPx, 100);
});

test("test_a_dot_after_the_last_tick_goes_in_the_last_row", () => {
    // session a has two dots after the last tick
    const lastTickOffsetMs = 2 * ROW_MS;
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + lastTickOffsetMs + 1000, BASE_MS + lastTickOffsetMs + 5000]]]);
    const list = [buildDot("a", lastTickOffsetMs + 1000, 1), buildDot("a", lastTickOffsetMs + 5000, 2)];
    const placements = computeSessionDotPlacements(list, buildTicks(), instants);
    // the dots start level with the last tick and go down from there
    assert.equal(placements[0]!.axisPx, 500);
    assert.equal(placements[1]!.axisPx, 500 + SESSION_DOT_PX);
});

test("test_no_two_dots_of_one_session_share_a_position", () => {
    // session a has four dots over two rows, two of them at one instant
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 1000, BASE_MS + 2000, BASE_MS + ROW_MS + 1000]]]);
    const list = [buildDot("a", 1000, 1), buildDot("a", 1000, 2), buildDot("a", 2000, 3), buildDot("a", ROW_MS + 1000, 4)];
    const placements = computeSessionDotPlacements(list, buildTicks(), instants);
    // every axis position and stack pair is different
    const seenPositions = new Set<string>();
    for (const placement of placements) {
        seenPositions.add(`${placement.axisPx}/${placement.stack}`);
    }
    assert.deepEqual([...seenPositions].sort(), ["100/0", "100/1", "114/0", "300/0"]);
});

test("test_dots_at_one_instant_get_stacks_zero_one_two_in_file_line_order", () => {
    // session a has lines 1, 2, 3 at one instant and line 4 at the next; session b has line 5 at the first instant
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 1000, BASE_MS + 1000, BASE_MS + 2000]], ["b", [BASE_MS + 1000]]]);
    const list = [buildDot("a", 1000, 1), buildDot("a", 1000, 2), buildDot("a", 1000, 3), buildDot("a", 2000, 4), buildDot("b", 1000, 5)];
    const placementByLine = new Map<number, Placement>();
    for (const placement of computeSessionDotPlacements(list, buildTicks(), instants)) {
        placementByLine.set(placement.annotation.line, placement);
    }
    // stacks of lines 1 to 5 are 0, 1, 2, 0, 0 and the rows are 100, 100, 100, 114, 100
    const expectedStacks = [0, 1, 2, 0, 0];
    const expectedAxisPx = [100, 100, 100, 114, 100];
    for (let line = 1; line <= 5; line++) {
        assert.equal(placementByLine.get(line)!.stack, expectedStacks[line - 1]);
        assert.equal(placementByLine.get(line)!.axisPx, expectedAxisPx[line - 1]);
    }
});

test("test_two_dots_at_the_same_timestamp_share_axisPx_and_get_stacks_zero_and_one", () => {
    // two dots of session s1 share the instant 06:17:21.308, and the ticks are 06:17:21 and 06:18:21
    const dotMs = Date.parse("2026-04-11T06:17:21.308Z");
    const ticks: WireRulerTick[] = [
        { instant: "2026-04-11T06:17:21.000Z", axisPx: 400, eventCount: 0, dotBlockPx: 14 },
        { instant: "2026-04-11T06:18:21.000Z", axisPx: 500, eventCount: 0, dotBlockPx: 14 },
    ];
    const instants: SessionDotInstants = new Map([["s1", [dotMs, dotMs]]]);
    const placements = computeSessionDotPlacements([buildDot("s1", dotMs - BASE_MS, 2), buildDot("s1", dotMs - BASE_MS, 3)], ticks, instants);
    // both dots sit at axisPx 400 with stacks 0 and 1, line 2 first
    assert.deepEqual([placements[0]!.annotation.line, placements[0]!.axisPx, placements[0]!.stack], [2, 400, 0]);
    assert.deepEqual([placements[1]!.annotation.line, placements[1]!.axisPx, placements[1]!.stack], [3, 400, 1]);
});

test("test_the_next_instant_goes_one_line_lower_after_a_same_instant_group", () => {
    // session a has two dots at one instant and one dot at the next instant
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 1000, BASE_MS + 2000]]]);
    const list = [buildDot("a", 1000, 1), buildDot("a", 1000, 2), buildDot("a", 2000, 3)];
    const placements = computeSessionDotPlacements(list, buildTicks(), instants);
    // the group shares one row and the next instant is one line lower
    assert.equal(placements[0]!.axisPx, 100);
    assert.equal(placements[1]!.axisPx, 100);
    assert.equal(placements[2]!.axisPx, 100 + SESSION_DOT_PX);
});

test("test_a_session_with_no_instants_throws", () => {
    // a dot belongs to session ghost, but the instants hold only session a
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000]]]);
    // the placement fails loudly
    assert.throws(() => computeSessionDotPlacements([buildDot("ghost", 1000, 1)], buildTicks(), instants));
});

test("test_a_session_line_runs_from_its_first_dot_to_its_last_dot_across_rows", () => {
    // session a has two dots in row 1 and two in row 2
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 2000, BASE_MS + ROW_MS + 1000, BASE_MS + ROW_MS + 2000]]]);
    const spans: WireSessionSpan[] = [{ sessionId: "a", first: new Date(BASE_MS + 1000).toISOString(), last: new Date(BASE_MS + ROW_MS + 2000).toISOString() }];
    const pixelSpans = listSessionPixelSpansFromInstants(spans, buildTicks(), instants);
    // the line starts level with tick 1 and ends at the second dot of row 2
    assert.equal(pixelSpans[0]!.sessionId, "a");
    assert.equal(pixelSpans[0]!.firstPx, 100);
    assert.equal(pixelSpans[0]!.lastPx, 300 + SESSION_DOT_PX);
});

test("test_a_session_line_ends_at_its_last_distinct_instant", () => {
    // session a has two dots at one instant
    const instants: SessionDotInstants = new Map([["a", [BASE_MS + 1000, BASE_MS + 1000]]]);
    const spans: WireSessionSpan[] = [{ sessionId: "a", first: new Date(BASE_MS + 1000).toISOString(), last: new Date(BASE_MS + 1000).toISOString() }];
    const pixelSpans = listSessionPixelSpansFromInstants(spans, buildTicks(), instants);
    // the line starts and ends level with tick 1
    assert.equal(pixelSpans[0]!.firstPx, 100);
    assert.equal(pixelSpans[0]!.lastPx, 100);
});
