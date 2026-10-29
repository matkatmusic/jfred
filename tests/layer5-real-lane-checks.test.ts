// Capture-free tests for the Layer 5 real lane checks: bad facts add the named failure.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateLanes } from "../scripts/visual/layer5-real-lane-checks.ts";
import type { BubbleFacts, DrawnLane, LaneFacts, PageFacts, PayloadLane } from "../scripts/visual/layer5-real-facts.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const LANE_FACTS: LaneFacts = {
    splitTop: 70, splitStyle: "dashed", railStyle: "dashed", railOpacity: 0.5,
    mergeBottom: 49, bnodeOpacities: [0.38, 0.38], bnodeMaxCy: 40,
};
const BUBBLE: BubbleFacts = {
    path: "a.ts", trunkRailLeft: 5, trunkRailStyle: "solid",
    trunk: [{ instant: "2026-01-01T00:00:10.000Z", opacity: 1, cy: 49 }], lanes: [LANE_FACTS],
};
const PAGE: PageFacts = { ticks: [{ text: "01-01 00:00:10.000 x", cy: 70 }], plainRailLeft: null, bubbles: [BUBBLE] };
const PAYLOAD = { forkAt: "2026-01-01T00:00:10.000Z", rejoinAt: "2026-01-01T00:00:10.000Z", rewindKind: "conversation" } as PayloadLane;

function buildLane(facts: Partial<LaneFacts>, payload: Partial<PayloadLane> = {}): DrawnLane {
    return { path: "a.ts", payload: { ...PAYLOAD, ...payload }, facts: { ...LANE_FACTS, ...facts }, bubble: BUBBLE };
}

function listFailuresOf(lanes: DrawnLane[]): string[] {
    const before = failures.length;
    validateLanes(lanes, PAGE);
    const added = failures.slice(before);
    failures.length = before;
    return added;
}

test("validateLanes passes for a dashed, level, dimmed lane that merges at its rejoin node", () => {
    assert.deepEqual(listFailuresOf([buildLane({})]), []);
});

test("validateLanes fails the split check when the elbow is solid", () => {
    assert.deepEqual(listFailuresOf([buildLane({ splitStyle: "solid" })]),
        ["l5-real every split elbow is dashed and level with the ruler tick of its forkAt"]);
});

test("validateLanes fails the merge presence check when a rejoining lane draws no merge elbow", () => {
    const failed = listFailuresOf([buildLane({ mergeBottom: null })]);
    assert.ok(failed.includes("l5-real a merge elbow is drawn exactly when the lane has rejoinAt or keptToEnd"));
});

test("validateLanes fails the rail and dot checks for a bright rail and a lane with no dots", () => {
    const failed = listFailuresOf([buildLane({ railOpacity: 1, bnodeOpacities: [] })]);
    assert.deepEqual(failed, ["l5-real every branch rail is dashed and dimmer than 1", "l5-real every branch dot has opacity about .38"]);
});

test("validateLanes fails the keptToEnd check when the elbow is above the lowest dot", () => {
    const failed = listFailuresOf([buildLane({ mergeBottom: 20 }, { rejoinAt: undefined, keptToEnd: true })]);
    assert.deepEqual(failed, ["l5-real every keptToEnd merge elbow ends level with the lowest dot of its bubble"]);
});
