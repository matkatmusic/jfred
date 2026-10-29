import { test } from "node:test";
import assert from "node:assert/strict";
import { printResult, type ScenarioResult } from "../scripts/coverage_report.ts";

test("test_printResult_prints_a_fail_row_then_a_line_per_mismatch_and_provenance_line", (t) => {
  // Behavior: a failing result prints its row, the step line, and one arrow line per non-empty provenance line.
  const logged: string[] = [];
  t.mock.method(console, "log", (line: string) => {
    logged.push(line);
  });
  const result: ScenarioResult = {
    scenario: { scenarioId: "s1", dirName: "s1-dir", jsonlPaths: [], stepStatesDir: "" },
    passed: 1,
    userEdits: 0,
    total: 2,
    mismatches: [{ stepNum: 2, jsonlLine: "line 5", diff: "a.py differs", provenance: "stageA: did a\n\nstageB: did b" }],
  };
  printResult(result);
  assert.deepEqual(logged, [
    "FAIL s1    1/2  s1-dir",
    "       step 2  line 5  a.py differs",
    "         ↳ stageA: did a",
    "         ↳ stageB: did b",
  ]);
});
