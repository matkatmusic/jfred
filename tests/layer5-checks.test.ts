// Capture-free test for validateLayer5: a fake page answers each probe and the screenshot stops the run.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { validateLayer5 } from "../scripts/visual/layer5-checks.ts";
import { formatTickStamp, PLAIN_BUBBLE_TRUNK_RAIL_LEFT, TICK_ROWS, type BubbleFacts, type LaneFacts, type Rect } from "../scripts/visual/layer5-bubble-facts.ts";
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

function makeBubble(right: number, mergeCount: number, lanes: LaneFacts[]): BubbleFacts {
    return {
        rect: makeRect(100, right, 0, 1000), laneW: 40, trunkRailLeft: 10, trunkRailStyle: "solid",
        lanes, trunkOpacities: [1, 1], mergeCount,
    };
}

const UTIL_LANE = makeLane(150, 50, ["2026-06-01T14:31:00.000Z", "2026-06-01T14:32:00.000Z"]);
const MERGING_LANE = { ...makeLane(150, 120, ["2026-06-02T14:31:00.000Z", "2026-06-02T14:32:00.000Z"]), mergeBottom: 300, rejoinCentreY: 300, mergeInFirstLane: true };
const SECOND_LANE = makeLane(200, 190, ["2026-06-03T14:31:00.000Z", "2026-06-03T14:32:00.000Z"]);
const UTIL = makeBubble(400, 0, [UTIL_LANE]);
const INDEX = makeBubble(500, 1, [MERGING_LANE, SECOND_LANE]);

function listTickRows() {
    const ticks = [];
    for (const lane of [UTIL_LANE, MERGING_LANE, SECOND_LANE]) {
        for (const node of lane.bnodes) {
            ticks.push({ text: `${formatTickStamp(node.instant)} (1)`, cy: node.cy });
        }
    }
    return ticks;
}

function answerProbe(expression: string): unknown {
    if (expression === TICK_ROWS) {
        return listTickRows();
    }
    if (expression === PLAIN_BUBBLE_TRUNK_RAIL_LEFT) {
        return 10;
    }
    if (expression.startsWith("(b => {")) {
        return expression.includes("src/util.ts") ? UTIL : INDEX;
    }
    if (expression.includes("'.blane').length === 0")) {
        return true;
    }
    if (expression.includes("rewind")) {
        return 0;
    }
    if (expression.includes("'.ruler').length")) {
        return 1;
    }
    return undefined;
}

function makeFakePage(): HeadlessPage {
    const refuse = async () => { throw new Error("the fake page does not do this"); };
    return {
        evaluate: async <T>(expression: string) => answerProbe(expression) as T,
        waitFor: async () => {},
        navigate: async () => {},
        screenshot: async () => { throw new Error("stop at the screenshot"); },
        close: refuse,
    };
}

test("validateLayer5 passes every check for good facts, then stops at the screenshot", async (context) => {
    context.mock.method(console, "log", () => {});
    const before = failures.length;
    await assert.rejects(validateLayer5(makeFakePage(), "http://x/"), /stop at the screenshot/);
    const added = failures.slice(before);
    failures.length = before;
    assert.deepEqual(added, []);
});
