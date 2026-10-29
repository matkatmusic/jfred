import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditFindings, scanJsonlText } from "../scripts/audit_unmodeled_fields.ts";

test("test_scanJsonlText_counts_blank_and_unparseable_lines", () => {
  // Scenario: blank lines are ignored and bad JSON is counted as unparseable.
  const findings = createAuditFindings();
  scanJsonlText("proj/a.jsonl", "\n{not json\n", findings);
  assert.equal(findings.totalLines, 1);
  assert.equal(findings.unparseableLines, 1);
});
