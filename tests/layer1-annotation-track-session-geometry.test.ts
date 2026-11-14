// Tasks 908 and 911: in session layout same-instant dots share a row, lanes widen for them, and every lane keeps room for its pair bracket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildDot } from "./layer1-session-dots-test-helpers.ts";
// task 912: bracket room is off, so the bracket names and the 14px stack step are no longer used here.
// import { BRACKET_OFFSET_PX, BRACKET_WIDTH_PX, DOT_STACK_STEP_PX, DOT_WIDTH_PX } from "../webapp/layer1-components/session-column/layer1-session-lanes.ts";
import { DOT_WIDTH_PX, LANE_STEP_PX } from "../webapp/layer1-components/session-column/layer1-session-lanes.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const { renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const START_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const MINUTE_MS = 60_000;

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Rows at 0, 100, 200, 300 px, one per hour; dotBlockPx is set only for a session layout.
function buildFourTicks(hasDotBlocks: boolean): WireRulerTick[] {
    const ticks: WireRulerTick[] = [];
    for (let index = 0; index < 4; index++) {
        const tick: WireRulerTick = { instant: new Date(START_MS + index * HOUR_MS).toISOString(), axisPx: index * 100, eventCount: 1 };
        if (hasDotBlocks) {
            tick.dotBlockPx = 56;
        }
        ticks.push(tick);
    }
    return ticks;
}

function buildDotAt(id: string, sessionId: string, hours: number, minutes: number, kind: WireRecordKind = WireRecordKind.user): WireAnnotation {
    return buildDot(id, new Date(START_MS + hours * HOUR_MS + minutes * MINUTE_MS).toISOString(), sessionId, kind);
}

// s1: u1 and u2 at the same instant, u3 an hour later. s2: a tool pair p, one hour apart. The two sessions overlap in y, so s1 is lane 0 and s2 is lane 1.
function buildGeometryDots(): WireAnnotation[] {
    const toolUse = { ...buildDotAt("t1", "s2", 1, 20, WireRecordKind.toolUse), pairId: "p" };
    const toolResult = { ...buildDotAt("t2", "s2", 2, 20, WireRecordKind.toolResult), pairId: "p" };
    return [buildDotAt("u1", "s1", 1, 10), buildDotAt("u2", "s1", 1, 10), buildDotAt("u3", "s1", 2, 10), toolUse, toolResult];
}

async function showGeometryDots(hasDotBlocks: boolean): Promise<void> {
    initLayer1Dom();
    storeAnnotations({ annotations: buildGeometryDots() });
    renderAnnotationTrack(buildFourTicks(hasDotBlocks));
    await toggleSessionDotLines();
}

function readStyleNumber(element: HTMLElement, propertyName: string): number {
    return Number.parseFloat(element.style.getPropertyValue(propertyName));
}

function readDrawnNode(recordId: string): HTMLElement {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .anode[data-record-id="${recordId}"]`)!;
}

function readDotBox(recordId: string): Box {
    const node = readDrawnNode(recordId);
    // task 912: session layout steps a stack by 17px.
    // const centerX = readStyleNumber(node, "--lane-x") + readStyleNumber(node, "--stack") * DOT_STACK_STEP_PX;
    const centerX = readStyleNumber(node, "--lane-x") + readStyleNumber(node, "--stack") * LANE_STEP_PX;
    return { left: centerX - DOT_WIDTH_PX / 2, top: readStyleNumber(node, "--axis-px") - 7, width: DOT_WIDTH_PX, height: 14 };
}

// task 912: bracket room is off; only the commented-out bracket test used this helper.
// function readBracketBox(): Box {
//     const bracket = document.querySelector<HTMLElement>('.abracket[data-pair-id="p"]')!;
//     return { left: readStyleNumber(bracket, "--lane-x") - BRACKET_OFFSET_PX, top: readStyleNumber(bracket, "--axis-px"), width: BRACKET_WIDTH_PX, height: readStyleNumber(bracket, "--span-px") };
// }

function computeOverlapPx(firstStart: number, firstLength: number, secondStart: number, secondLength: number): number {
    const overlapPx = Math.min(firstStart + firstLength, secondStart + secondLength) - Math.max(firstStart, secondStart);
    return Math.max(0, overlapPx);
}

function computeIntersectionArea(first: Box, second: Box): number {
    return computeOverlapPx(first.left, first.width, second.left, second.width) * computeOverlapPx(first.top, first.height, second.top, second.height);
}

// task 912: renamed, the second dot now jumps over the neighbour lane slot.
test("test_same_timestamp_dots_of_one_session_sit_on_one_row_and_jump_over_the_neighbour_slot", async () => {
    // Scenario: u1 and u2 of s1 share one instant in row 1; u3 is an hour later in row 2.
    await showGeometryDots(true);
    // Both dots are on the row line at 100 px; u2 jumps over t1 in slot 1, so u2 sits two slots right of u1.
    assert.deepEqual([readStyleNumber(readDrawnNode("u1"), "--axis-px"), readStyleNumber(readDrawnNode("u2"), "--axis-px")], [100, 100]);
    // task 912: u2 is slot 2 because t1 of s2 holds slot 1 on this line.
    // assert.deepEqual([readStyleNumber(readDrawnNode("u1"), "--stack"), readStyleNumber(readDrawnNode("u2"), "--stack")], [0, 1]);
    assert.deepEqual([readStyleNumber(readDrawnNode("u1"), "--stack"), readStyleNumber(readDrawnNode("u2"), "--stack")], [0, 2]);
    assert.equal(readStyleNumber(readDrawnNode("u2"), "--lane-x"), readStyleNumber(readDrawnNode("u1"), "--lane-x"));
    // The later dot is on the next row line.
    assert.equal(readStyleNumber(readDrawnNode("u3"), "--axis-px"), 200);
});

// task 912: lanes are fixed slots now, a two-dot line no longer pushes the next lane right.
// test("test_a_lane_with_two_dots_at_one_instant_pushes_the_next_lane_right", async () => {
//     // Scenario: lane 0 (s1) holds two dots side by side, so lane 1 (s2) starts further right: 18 + 17 + 8 + 14 = 57.
//     await showGeometryDots(true);
//     assert.equal(readDrawnNode("u1").style.getPropertyValue("--lane-x"), "18px");
//     assert.equal(readDrawnNode("t1").style.getPropertyValue("--lane-x"), "57px");
//     // The track is as wide as the last lane x plus the end pad: 57 + 22.
//     assert.equal(document.getElementById("sessionDataContainer")!.style.getPropertyValue("--track-w"), "79px");
// });

test("test_lanes_sit_17px_apart_and_the_track_is_as_wide_as_the_slot_count", async () => {
    // Scenario: s1 is lane slot 0, s2 is lane slot 1, and u2 uses slot 2, so the track has three slots.
    await showGeometryDots(true);
    assert.equal(readDrawnNode("u1").style.getPropertyValue("--lane-x"), "18px");
    assert.equal(readDrawnNode("t1").style.getPropertyValue("--lane-x"), "35px");
    // The track is as wide as the last slot x plus the end pad: 18 + 2 x 17 + 22.
    assert.equal(document.getElementById("sessionDataContainer")!.style.getPropertyValue("--track-w"), "74px");
});

// task 912: bracket room is off (user ruling); the bracket at x 20 to 26 now overlaps u1 at x 11 to 25.
// test("test_the_bracket_of_a_neighbour_lane_is_not_covered_by_any_dot", async () => {
//     // Scenario: the dashed bracket of pair p is drawn in lane 1; the dots of s1 are in lane 0.
//     await showGeometryDots(true);
//     const bracketBox = readBracketBox();
//     assert.equal(bracketBox.left, 42);
//     // No dot of s1 touches the bracket box.
//     for (const recordId of ["u1", "u2", "u3"]) {
//         assert.equal(computeIntersectionArea(readDotBox(recordId), bracketBox), 0, `${recordId} covers the bracket`);
//     }
//     // The right edge of u2 is 39 px; at least 3 px stay clear before the bracket.
//     const secondDotBox = readDotBox("u2");
//     assert.equal(secondDotBox.left + secondDotBox.width, 39);
//     assert.ok(bracketBox.left - (secondDotBox.left + secondDotBox.width) >= 3);
// });

test("test_time_layout_lanes_keep_todays_x", async () => {
    // Scenario: the same annotations on ticks without dotBlockPx; lane 1 stays 17 px after lane 0 and the width has no bracket room.
    await showGeometryDots(false);
    assert.equal(readDrawnNode("t1").style.getPropertyValue("--lane-x"), "35px");
    assert.equal(document.getElementById("sessionDataContainer")!.style.getPropertyValue("--track-w"), "57px");
});

test("test_every_dot_box_is_clear_of_every_other_dot_box_in_session_layout", async () => {
    // Scenario: five dots are drawn; no two dot boxes share any area.
    await showGeometryDots(true);
    const recordIds = ["u1", "u2", "u3", "t1", "t2"];
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent .anode").length, recordIds.length);
    for (let firstIndex = 0; firstIndex < recordIds.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < recordIds.length; secondIndex++) {
            const intersectionArea = computeIntersectionArea(readDotBox(recordIds[firstIndex]!), readDotBox(recordIds[secondIndex]!));
            assert.equal(intersectionArea, 0, `${recordIds[firstIndex]} and ${recordIds[secondIndex]} overlap`);
        }
    }
});

test("test_the_track_has_the_session_layout_class_only_in_session_layout", async () => {
    // Scenario: the same annotations are drawn once with dot blocks and once without.
    await showGeometryDots(true);
    assert.equal(document.getElementById("sessionDotLinesComponent")!.classList.contains("is-session-layout"), true);
    await showGeometryDots(false);
    assert.equal(document.getElementById("sessionDotLinesComponent")!.classList.contains("is-session-layout"), false);
});

test("test_a_connector_is_drawn_only_for_the_line_with_extra_dots", async () => {
    // Scenario: only the y 100 line of s1 has an extra dot (u2), so one connector is drawn there.
    await showGeometryDots(true);
    const connectors = document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .aconnector");
    assert.equal(connectors.length, 1);
    assert.equal(connectors[0]!.dataset["sessionId"], "s1");
    assert.equal(readStyleNumber(connectors[0]!, "--axis-px"), 100);
    assert.equal(readStyleNumber(connectors[0]!, "--stack"), 2);
    // In time layout u1 and u2 have stack 1, which draws no connector.
    await showGeometryDots(false);
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent .aconnector").length, 0);
});
