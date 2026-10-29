// Every covered scenario must reproduce each captured step folder; known engine gaps fail red on purpose.

import test from "node:test";
import assert from "node:assert/strict";
import { listCoveredScenarios } from "../scripts/coverage_scenarios.ts";
import { validateScenarioResilient } from "../scripts/check_scenario_coverage.ts";
import type { ScenarioResult } from "../scripts/coverage_report.ts";

// The failing step folders, one per line, for an assertion message.
function describeMismatches(result: ScenarioResult): string {
    const mismatchLines = result.mismatches.map((mismatch) => `  step ${mismatch.stepNum}  ${mismatch.jsonlLine}  ${mismatch.diff}`);
    return mismatchLines.join("\n");
}

for (const scenario of listCoveredScenarios()) {
    test(`${scenario.scenarioId} reproduces every captured step state`, () => {
        const result = validateScenarioResilient(scenario);
        assert.ok(result.total > 0, `${scenario.scenarioId}: no step-state folders found`);
        assert.equal(
            result.mismatches.length,
            0,
            `${scenario.scenarioId} (${scenario.dirName}) failed ${result.mismatches.length}/${result.total} steps:\n${describeMismatches(result)}`,
        );
    });
}

