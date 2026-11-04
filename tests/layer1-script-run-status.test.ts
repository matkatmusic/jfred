// Per-file test for webapp/layer1-script-run-status.ts: the three drawer marks read the stored result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { buildScriptRunStatusBadges, computeRunStatus } from "../webapp/layer1-script-run-status.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { SCRIPT_RUN } from "./layer1-drawer-script-helpers.ts";

const EMPTY_VIEW: WireLayer1View = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

function storeOutcome(overrides: Partial<WireScriptResult>): void {
  initLayer1Dom();
  resetRunResults();
  const result: WireScriptResult = {
    kind: "script-result", toolUseId: SCRIPT_RUN.toolUseId, outcome: WireRunOutcome.replayed, files: [],
    stdout: "", stderr: "", timedOut: false, isOutputSaved: true, ...overrides,
  };
  storeRunResult(EMPTY_VIEW, result);
}

function readBadges(): string[] {
  const header = document.createElement("div");
  header.replaceChildren(...buildScriptRunStatusBadges(SCRIPT_RUN));
  return [...header.querySelectorAll(".run-check, .run-status")].map((badge) => badge.textContent!);
}

test("test_a_run_that_never_started_shows_the_three_old_marks", () => {
  // Verify: Verified and Replayed are crosses; Located is a check.
  initLayer1Dom();
  resetRunResults();
  assert.deepEqual(computeRunStatus(SCRIPT_RUN), { verified: false, located: true, replayed: false });
  assert.deepEqual(readBadges(), ["Verified: ", "❌", "Located: ", "✅", "Replayed: ", "❌"]);
});

test("test_a_verified_replay_shows_only_the_verified_mark", () => {
  // Verify: a verified run needs no other check.
  storeOutcome({ confidence: WireConfidence.verified });
  assert.deepEqual(computeRunStatus(SCRIPT_RUN), { verified: true, located: true, replayed: true });
  assert.deepEqual(readBadges(), ["Verified: ", "✅"]);
});

test("test_a_mismatch_replay_is_replayed_but_not_verified", () => {
  // Verify: replayed turns to a check, verified stays a cross.
  storeOutcome({ confidence: WireConfidence.mismatch });
  assert.deepEqual(readBadges(), ["Verified: ", "❌", "Located: ", "✅", "Replayed: ", "✅"]);
});

test("test_failed_skipped_and_original_failed_runs_are_not_replayed", () => {
  // Verify: replay-failed, not-replayed and original-failed all leave Replayed as a cross.
  for (const outcome of [WireRunOutcome.replayFailed, WireRunOutcome.notReplayed, WireRunOutcome.originalFailed]) {
    storeOutcome({ outcome });
    assert.deepEqual(computeRunStatus(SCRIPT_RUN), { verified: false, located: true, replayed: false });
    assert.equal(readBadges().at(-1), "❌");
  }
});
