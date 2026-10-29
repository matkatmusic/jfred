// Capture-free tests for the Layer 5 real trunk rail and named merge checks.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateNamedMerge, validateTrunkRails } from "../scripts/visual/layer5-real-trunk-checks.ts";
import { JOT_MERGE_PATH, type BubbleFacts, type DrawnLane, type LaneFacts, type PageFacts, type PayloadLane } from "../scripts/visual/layer5-real-facts.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const LANE_FACTS = { mergeBottom: 49 } as LaneFacts;

function buildBubble(trunkRailLeft: number, trunkRailStyle: string): BubbleFacts {
    return { path: "a.ts", trunkRailLeft, trunkRailStyle, trunk: [], lanes: [] };
}

function buildLane(path: string, payload: Partial<PayloadLane>, mergeBottom: number | null): DrawnLane {
    return { path, payload: payload as PayloadLane, facts: { ...LANE_FACTS, mergeBottom }, bubble: buildBubble(0, "solid") };
}

function listFailuresOf(run: () => void): string[] {
    const before = failures.length;
    run();
    const added = failures.slice(before);
    failures.length = before;
    return added;
}

test("validateTrunkRails passes for solid rails at the plain rail x", () => {
    const page: PageFacts = { ticks: [], plainRailLeft: 5, bubbles: [buildBubble(5.5, "solid")] };
    assert.deepEqual(listFailuresOf(() => validateTrunkRails(page)), []);
});

test("validateTrunkRails fails a dashed rail and a shifted rail", () => {
    const page: PageFacts = { ticks: [], plainRailLeft: 5, bubbles: [buildBubble(9, "dashed")] };
    assert.deepEqual(listFailuresOf(() => validateTrunkRails(page)), [
        "l5-real every trunk rail in a lane bubble is solid",
        "l5-real the trunk rail sits at the same x as in a branch-less bubble",
    ]);
});

test("validateTrunkRails skips the x comparison when every pair has lanes", () => {
    const page: PageFacts = { ticks: [], plainRailLeft: null, bubbles: [buildBubble(9, "solid")] };
    assert.deepEqual(listFailuresOf(() => validateTrunkRails(page)), []);
});

test("validateNamedMerge passes when the named jot lane has a merge elbow", () => {
    const lanes = [buildLane(JOT_MERGE_PATH, { rewindKind: "conversation" }, 49)];
    assert.deepEqual(listFailuresOf(() => validateNamedMerge(lanes, true, false)), []);
});

test("validateNamedMerge fails when the named jot lane has no merge elbow", () => {
    const lanes = [buildLane(JOT_MERGE_PATH, { rewindKind: "code" }, null)];
    assert.deepEqual(listFailuresOf(() => validateNamedMerge(lanes, true, false)), [`l5-real ${JOT_MERGE_PATH} has a lane with a merge elbow`]);
});

test("validateNamedMerge derives from the payload when the named path is not drawn", () => {
    const lanes = [buildLane("x.ts", { rewindKind: "code" }, 49), buildLane("y.ts", { rewindKind: "conversation", rejoinAt: "t" }, null)];
    assert.deepEqual(listFailuresOf(() => validateNamedMerge(lanes, false, false)), [
        "l5-real every drawn lane with rejoinAt shows a merge elbow",
        "l5-real no drawn code lane shows a merge elbow",
    ]);
});
