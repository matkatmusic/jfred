import { test } from "node:test";
import assert from "node:assert/strict";
import { findFirstLineDifference } from "../scripts/coverage_compare.ts";

test("test_findFirstLineDifference_reports_missing_line_as_empty", () => {
  // Scenario: a shorter text differs from the longer one at the first extra line.
  const diff = findFirstLineDifference("a\nb", "a");
  assert.deepEqual(diff, { lineNo: 2, expected: "b", actual: "" });
});
