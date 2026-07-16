// Content-based, re-run-stable scenario regression: for every executed scenario with captured `.step_states`,
// reconstruct its engine steps and prove every captured step folder is reproduced byte-for-byte by some
// engine step. This replaces the old per-scenario fixture tests (which hard-coded run-specific uuids, line
// numbers, and rendered text and broke on every re-run). New scenarios are picked up automatically. The
// known engine-gap scenarios (rename family, git-baseline s40+, parser-crashing compact family) fail RED on
// purpose — that is genuine engine signal, not stale-test noise. Tool internals: scripts/check_scenario_coverage.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { listCoveredScenarios } from "../scripts/coverage_scenarios.ts";
import { checkScenarioResilient, type ScenarioResult } from "../scripts/check_scenario_coverage.ts";

// The failing step folders, one per line, for an assertion message.
function describeMismatches(result: ScenarioResult): string {
    const mismatchLines = result.mismatches.map((mismatch) => `  step ${mismatch.stepNum}  ${mismatch.jsonlLine}  ${mismatch.diff}`);
    return mismatchLines.join("\n");
}

for (const scenario of listCoveredScenarios()) {
    test(`${scenario.scenarioId} reproduces every captured step state`, () => {
        const result = checkScenarioResilient(scenario);
        assert.ok(result.total > 0, `${scenario.scenarioId}: no step-state folders found`);
        assert.equal(
            result.mismatches.length,
            0,
            `${scenario.scenarioId} (${scenario.dirName}) failed ${result.mismatches.length}/${result.total} steps:\n${describeMismatches(result)}`,
        );
    });
}

