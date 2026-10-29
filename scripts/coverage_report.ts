// Prints one scenario's row in the coverage matrix.

import type { CoveredScenario } from "./coverage_scenarios.ts";
import type { StepMismatch } from "./coverage_step_mismatch.ts";

// A scenario's per-step result: how many captured folders some engine step reproduced, and the misses.
export type ScenarioResult = {
  scenario: CoveredScenario;
  passed: number;
  userEdits: number;
  total: number;
  mismatches: StepMismatch[];
};

// Print one scenario's row in the coverage matrix, plus a line per mismatch.
export function printResult(result: ScenarioResult): void {
  const status = result.mismatches.length === 0 ? "OK  " : "FAIL";
  const userEditNote = result.userEdits > 0 ? `  (${result.userEdits} user-edit)` : "";
  console.log(`${status} ${result.scenario.scenarioId.padEnd(5)} ${result.passed}/${result.total}  ${result.scenario.dirName}${userEditNote}`);
  for (const mismatch of result.mismatches) {
    console.log(`       step ${mismatch.stepNum}  ${mismatch.jsonlLine}  ${mismatch.diff}`);
    const provenanceLines = mismatch.provenance.split("\n");
    for (const line of provenanceLines) {
      const isEmpty = line.length === 0;
      if (!isEmpty) {
        console.log(`         ↳ ${line}`);
      }
    }
  }
}
