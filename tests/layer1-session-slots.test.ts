// Slot rule of the session column (ported from the signed-off mockup).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDotLineKey, computeSessionSlots } from "../webapp/layer1-components/session-column/layer1-session-slots.ts";
import type { SessionDotLine, SessionDotLines } from "../webapp/layer1-components/session-column/layer1-session-slots.ts";

// lines: [axisPx, dotCount] pairs, ascending by axisPx.
function buildSession(sessionId: string, lines: [number, number][]): SessionDotLines {
    const dotLines: SessionDotLine[] = [];
    for (const [axisPx, dotCount] of lines) {
        dotLines.push({ axisPx, dotCount });
    }
    return { sessionId, lines: dotLines };
}

test("test_the_worked_example_extra_dots_jump_over_the_neighbour_lanes", () => {
    // R has three dots on y40. E, B and P sit in slots 1, 2 and 3.
    const sessionR = buildSession("R", [[10, 1], [20, 1], [30, 1], [40, 3], [50, 1], [60, 1]]);
    const sessionE = buildSession("E", [[10, 1], [20, 1]]);
    const sessionB = buildSession("B", [[20, 1], [30, 1], [40, 1]]);
    const sessionP = buildSession("P", [[20, 1], [30, 1], [40, 1], [50, 1]]);
    const slots = computeSessionSlots([sessionR, sessionE, sessionB, sessionP]);
    // Lane slots follow start order.
    assert.equal(slots.laneSlotBySession.get("R"), 0);
    assert.equal(slots.laneSlotBySession.get("E"), 1);
    assert.equal(slots.laneSlotBySession.get("B"), 2);
    assert.equal(slots.laneSlotBySession.get("P"), 3);
    // The two extra dots of R jump over slots 2 and 3 and land in slot 4.
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("R", 40)), [0, 1, 4]);
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("B", 40)), [2]);
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("P", 50)), [3]);
    assert.equal(slots.slotCount, 5);
});

test("test_a_new_session_takes_the_slot_of_a_session_that_has_ended", () => {
    // A ends at y14. B starts at y28.
    const sessionA = buildSession("A", [[0, 1], [14, 1]]);
    const sessionB = buildSession("B", [[28, 1]]);
    const slots = computeSessionSlots([sessionA, sessionB]);
    assert.equal(slots.laneSlotBySession.get("B"), 0);
    assert.equal(slots.slotCount, 1);
});

test("test_a_new_session_skips_a_slot_whose_line_is_still_running", () => {
    // A has no dot at y14 but its line runs to y28.
    const sessionA = buildSession("A", [[0, 1], [28, 1]]);
    const sessionB = buildSession("B", [[14, 1]]);
    const slots = computeSessionSlots([sessionA, sessionB]);
    assert.equal(slots.laneSlotBySession.get("B"), 1);
    assert.equal(slots.slotCount, 2);
});

test("test_extra_dots_never_share_a_slot_with_the_lane_dot_of_a_new_session_on_the_same_line", () => {
    // X has three dots on y0. N starts on the same y.
    const sessionX = buildSession("X", [[0, 3]]);
    const sessionN = buildSession("N", [[0, 1]]);
    const slots = computeSessionSlots([sessionX, sessionN]);
    assert.equal(slots.laneSlotBySession.get("X"), 0);
    assert.equal(slots.laneSlotBySession.get("N"), 1);
    // The extra dots of X skip slot 1 because N has a dot there.
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("X", 0)), [0, 2, 3]);
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("N", 0)), [1]);
    assert.equal(slots.slotCount, 4);
});

test("test_extra_dots_are_placed_in_session_start_order_not_left_to_right", () => {
    // S0 ends at y30, so S2 reuses slot 0.
    const sessionS0 = buildSession("S0", [[10, 1], [20, 1], [30, 1]]);
    const sessionS1 = buildSession("S1", [[20, 1], [30, 1], [40, 1], [50, 2]]);
    const sessionS2 = buildSession("S2", [[40, 1], [50, 2]]);
    const slots = computeSessionSlots([sessionS0, sessionS1, sessionS2]);
    assert.equal(slots.laneSlotBySession.get("S0"), 0);
    assert.equal(slots.laneSlotBySession.get("S1"), 1);
    assert.equal(slots.laneSlotBySession.get("S2"), 0);
    // S1 is earlier in start order, so it takes slot 2 first. S2 then takes slot 3.
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("S1", 50)), [1, 2]);
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("S2", 50)), [0, 3]);
    assert.equal(slots.slotCount, 4);
});

test("test_slot_count_covers_the_extra_dot_slots", () => {
    // One session with three dots on one line.
    const slots = computeSessionSlots([buildSession("a", [[0, 3]])]);
    assert.deepEqual(slots.dotSlotsByLine.get(buildDotLineKey("a", 0)), [0, 1, 2]);
    assert.equal(slots.slotCount, 3);
});

test("test_buildDotLineKey_joins_session_and_y", () => {
    assert.equal(buildDotLineKey("a", 100), "a@100");
});
