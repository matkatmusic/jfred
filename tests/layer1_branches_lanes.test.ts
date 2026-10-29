// Lanes list changes below a rewind point; the group timeline is built once per cache entry.

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { collectSessionFileGroups, loadSessionRewinds } from "../src/layer1_branch_sessions.ts";
import { buildGroupHistories, listLanes } from "../src/layer1_branches_lanes.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { findScenarioJsonl } from "./scenario-locator.ts";

function loadScenarioRewinds(scenarioDir: string) {
    const jsonl = findScenarioJsonl(scenarioDir);
    const [group] = collectSessionFileGroups(listTranscriptFiles([dirname(jsonl)]));
    return loadSessionRewinds(group!);
}

test("test_listLanes_gives_a_lane_with_changes_for_a_rewound_scenario", () => {
    const lanes = listLanes(loadScenarioRewinds("s11-write-code-restore-rewrite"));
    assert.ok(lanes.length > 0);
    for (const lane of lanes) {
        assert.ok(lane.changeIds.size > 0);
        assert.ok(Number.isFinite(lane.forkAt.getTime()));
    }
});

test("test_buildGroupHistories_returns_the_same_histories_for_the_same_rewinds", () => {
    const rewinds = loadScenarioRewinds("s11-write-code-restore-rewrite");
    const histories = buildGroupHistories(rewinds);
    assert.ok(histories.length > 0);
    assert.equal(buildGroupHistories(rewinds), histories);
});
