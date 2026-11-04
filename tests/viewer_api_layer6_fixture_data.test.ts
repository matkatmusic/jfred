// Every fixture run the page can start has a canned result.

import assert from "node:assert/strict";
import { test } from "node:test";
import { WireScriptExecutorKind } from "../webapp/layer1-wire-script-runs.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";
import { FIXTURE_RUN_ID, L6_FIXTURE_RUNS } from "../src/viewer_api_layer6_fixture_blocked_runs.ts";
import { findCannedFixtureRun } from "../src/viewer_api_layer6_fixture_data.ts";

test("findCannedFixtureRun does not throw for any startable fixture python run", () => {
    const startableRuns = [...SCRIPT_RUNS, ...L6_FIXTURE_RUNS].filter(
        (run) => run.executorKind === WireScriptExecutorKind.python && run.confidence === undefined,
    );
    assert.ok(startableRuns.length > 0);
    for (const run of startableRuns) {
        // crashBlocked never starts: its blocker always crashes.
        if (run.toolUseId === FIXTURE_RUN_ID.crashBlocked) {
            continue;
        }
        assert.doesNotThrow(() => findCannedFixtureRun(run.toolUseId), run.toolUseId);
    }
});
