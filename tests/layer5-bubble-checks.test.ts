// Capture-free tests for the Layer 5 bubble checks: canned facts in, failed check names out.

import { strict as assert } from "node:assert";
import { test, type TestContext } from "node:test";
import { validateDotRows, validateElbows, validateTrunkAndRails, validateWidening } from "../scripts/visual/layer5-bubble-checks.ts";
import { formatTickStamp, type BubbleFacts, type LaneFacts, type Rect } from "../scripts/visual/layer5-bubble-facts.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

function makeRect(left: number, right: number, top: number, bottom: number): Rect {
    return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

function makeLane(laneX: number, forkY: number, instants: string[]): LaneFacts {
    const bnodes = [];
    let cy = forkY + 20;
    for (const instant of instants) {
        bnodes.push({ cy, opacity: 0.38, instant });
        cy += 30;
    }
    return {
        laneX, elbow: makeRect(110, 160, forkY, forkY + 10), elbowTopStyle: "dashed",
        rail: makeRect(155, 165, forkY + 10, 400), railStyle: "dashed", railOpacity: 0.5,
        mergeCount: 0, mergeBottom: undefined, mergeInFirstLane: false,
        bnodes, labelRects: [makeRect(laneX, laneX + 20, 0, 10)], forkCentreY: forkY, rejoinCentreY: undefined,
    };
}

function makeBubble(right: number, lanes: LaneFacts[]): BubbleFacts {
    return {
        rect: makeRect(100, right, 0, 1000), laneW: 40, trunkRailLeft: 10, trunkRailStyle: "solid",
        lanes, trunkOpacities: [1, 1], mergeCount: 0,
    };
}

function listFailuresOf(context: TestContext, run: () => void): string[] {
    context.mock.method(console, "log", () => {});
    const before = failures.length;
    run();
    const added = failures.slice(before);
    failures.length = before;
    return added;
}

const INSTANTS = ["2026-06-01T14:31:00.000Z", "2026-06-01T14:32:00.000Z"];

test("validateTrunkAndRails passes for a solid trunk and dim dashed branches", (context) => {
    const bubble = makeBubble(500, [makeLane(150, 50, INSTANTS)]);
    assert.deepEqual(listFailuresOf(context, () => validateTrunkAndRails("t", bubble, 10)), []);
});

test("validateTrunkAndRails fails a solid-trunk, a trunk-position, a rail, and a dot opacity check", (context) => {
    const lane = makeLane(150, 50, INSTANTS);
    const bubble = { ...makeBubble(500, [{ ...lane, railStyle: "solid", bnodes: [{ cy: 70, opacity: 2, instant: INSTANTS[0]! }] }]), trunkRailStyle: "dashed", trunkOpacities: [] };
    assert.deepEqual(listFailuresOf(context, () => validateTrunkAndRails("t", bubble, 30)), [
        "L5 t: the trunk rail is solid",
        "L5 t: the trunk rail sits where it sits in a bubble with no branches",
        "L5 t: every branch rail is dashed and dimmer than 1",
        "L5 t: every branch dot has opacity .38",
        "L5 t: every visible trunk node has opacity 1",
    ]);
});

test("validateElbows fails when an elbow does not start at its fork tick", (context) => {
    const lane = makeLane(150, 50, INSTANTS);
    assert.deepEqual(listFailuresOf(context, () => validateElbows("t", makeBubble(500, [lane]))), []);
    const moved = { ...lane, forkCentreY: 90 };
    assert.equal(listFailuresOf(context, () => validateElbows("t", makeBubble(500, [moved]))).length, 1);
});

test("validateWidening passes for a wider bubble with spaced lanes and fails a narrower one", (context) => {
    const lanes = [makeLane(150, 50, INSTANTS), makeLane(200, 50, INSTANTS)];
    const util = makeBubble(400, [lanes[0]!]);
    assert.deepEqual(listFailuresOf(context, () => validateWidening(makeBubble(500, lanes), util)), []);
    const crowded = [makeLane(150, 50, INSTANTS), makeLane(160, 50, INSTANTS)];
    assert.deepEqual(listFailuresOf(context, () => validateWidening(makeBubble(400, crowded), util)), [
        "L5 index.ts: lane x positions differ by at least the lane width",
        "L5 index.ts: the bubble is wider than the src/util.ts bubble",
    ]);
});

test("validateDotRows matches each dot to a ruler tick row and flags a dot with no tick", (context) => {
    const lanes = [makeLane(150, 50, INSTANTS), makeLane(200, 120, INSTANTS), makeLane(250, 190, INSTANTS)];
    const ticks: { text: string; cy: number }[] = [];
    for (const lane of lanes) {
        for (const node of lane.bnodes) {
            ticks.push({ text: `${formatTickStamp(node.instant)} (1)`, cy: node.cy });
        }
    }
    assert.deepEqual(listFailuresOf(context, () => validateDotRows(lanes, ticks)), []);
    assert.deepEqual(listFailuresOf(context, () => validateDotRows(lanes, ticks.slice(1))),
        ["L5 every branch dot sits level with the ruler tick of its own instant"]);
});
