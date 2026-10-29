import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import type { ProvenanceEntry } from "../src/reconstruction_provenance.ts";
import { buildStepMismatch, renderStepProvenance } from "../scripts/coverage_step_mismatch.ts";

test("test_buildStepMismatch_reports_zero_engine_steps_with_the_first_ground_truth_file", () => {
  // Behavior: with no engine steps the mismatch names the first ground-truth file and has no provenance.
  const groundTruth = new Map([["pkg/a.py", "x = 1\n"]]);
  const mismatch = buildStepMismatch(3, groundTruth, [], [], new Map(), []);
  assert.equal(mismatch.stepNum, 3);
  assert.equal(mismatch.jsonlLine, "(no engine steps)");
  assert.ok(mismatch.diff.startsWith("pkg/a.py: engine produced 0 steps"), mismatch.diff);
  assert.equal(mismatch.provenance, "");
});

test("test_renderStepProvenance_keeps_undated_entries_and_formats_the_change_id", () => {
  // Behavior: an entry with no backup time is kept, and a changeId is appended in parentheses.
  const entries: ProvenanceEntry[] = [
    { stage: "seedCopyEvents", target: new Path("/t/pkg/a.py"), detail: "seeded", changeId: "c1" as unknown as ProvenanceEntry["changeId"] },
  ];
  const rendered = renderStepProvenance(entries, "pkg/a.py", new Date("2026-01-01T00:00:10Z"));
  assert.equal(rendered, "seedCopyEvents: seeded (changeId c1)");
});
