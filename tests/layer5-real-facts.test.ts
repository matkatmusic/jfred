// The pure helpers of the Layer 5 real checks, tested without a browser.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { WireBranchesView } from "../webapp/layer1-wire-branches.ts";
import {
    containsMergeTarget, findRejoinCy, findTickCy, formatTickStamp, isNear, listDrawnLanes,
    type BubbleFacts, type DrawnLane, type LaneFacts, type PageFacts, type PayloadLane,
} from "../scripts/visual/layer5-real-facts.ts";

const LANE_FACTS: LaneFacts = {
    splitTop: 10, splitStyle: "dashed", railStyle: "dashed", railOpacity: 0.5,
    mergeBottom: 50, bnodeOpacities: [0.38], bnodeMaxCy: 40,
};
const BUBBLE: BubbleFacts = {
    path: "a.ts", trunkRailLeft: 5, trunkRailStyle: "solid",
    trunk: [{ instant: "2026-01-01T00:00:10.000Z", opacity: 1, cy: 49 }, { instant: "2026-01-01T00:00:10.000Z", opacity: 1, cy: 80 }],
    lanes: [LANE_FACTS, { ...LANE_FACTS, mergeBottom: null }],
};
const PAGE: PageFacts = { ticks: [{ text: "01-01 00:00:10.000 x", cy: 70 }], plainRailLeft: null, bubbles: [BUBBLE] };
const PAYLOAD = {
    pairs: [
        { path: "b.ts", branches: [] },
        { path: "a.ts", branches: [{ forkAt: "f1" }, { forkAt: "f2" }] },
    ],
} as unknown as WireBranchesView;

test("formatTickStamp turns an ISO instant into the ruler tick prefix", () => {
    assert.equal(formatTickStamp("2026-01-01T00:00:10.000Z"), "01-01 00:00:10.000");
});

test("isNear is true within one pixel and false for a missing side", () => {
    assert.equal(isNear(10, 11), true);
    assert.equal(isNear(10, 12), false);
    assert.equal(isNear(undefined, 12), false);
    assert.equal(isNear(10, undefined), false);
});

test("findTickCy finds the tick that starts with the instant stamp", () => {
    assert.equal(findTickCy(PAGE, "2026-01-01T00:00:10.000Z"), 70);
    assert.equal(findTickCy(PAGE, "2026-01-02T00:00:10.000Z"), undefined);
});

test("listDrawnLanes pairs each drawn lane with the payload lane of the same index", () => {
    const lanes = listDrawnLanes(PAYLOAD, PAGE);
    assert.deepEqual(lanes.map((lane) => [lane.path, lane.payload.forkAt]), [["a.ts", "f1"], ["a.ts", "f2"]]);
    assert.equal(lanes[1]!.facts.mergeBottom, null);
});

test("containsMergeTarget is true for rejoinAt or keptToEnd only", () => {
    assert.equal(containsMergeTarget({ rejoinAt: "x" } as PayloadLane), true);
    assert.equal(containsMergeTarget({ keptToEnd: true } as PayloadLane), true);
    assert.equal(containsMergeTarget({} as PayloadLane), false);
});

test("findRejoinCy prefers the trunk node level with the merge elbow, then the first, then the tick", () => {
    const payload = { rejoinAt: "2026-01-01T00:00:10.000Z" } as PayloadLane;
    const lane: DrawnLane = { path: "a.ts", payload, facts: LANE_FACTS, bubble: BUBBLE };
    assert.equal(findRejoinCy(lane, PAGE), 49);
    assert.equal(findRejoinCy({ ...lane, facts: { ...LANE_FACTS, mergeBottom: 0 } }, PAGE), 49);
    assert.equal(findRejoinCy({ ...lane, bubble: { ...BUBBLE, trunk: [] } }, PAGE), 70);
});
