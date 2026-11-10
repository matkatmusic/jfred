// Per-file test for webapp/layer1-run-placement.ts: replay results decide which files carry a script run's dots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReplayResultsToView } from "../webapp/layer1-run-placement.ts";
import { resetRunResults, markRunUnreplayed, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();

const RUN: WireScriptRun = {
  instant: "2026-07-01T10:00:00.000Z", axisPx: 7, toolUseId: "toolu_1", executorKind: "python", language: "python",
  line: 3, code: "x = 1", sessionId: "s1", sessionFile: "/logs/s1.jsonl",
};

function buildView(): WireLayer1View {
  const onDisk = { instant: RUN.instant, axisPx: 0 };
  return {
    pairs: [
      { path: "src/a.ts", commits: [], onDisk, scriptRuns: [{ ...RUN }] },
      { path: "src/b.ts", commits: [], onDisk, scriptRuns: [{ ...RUN }] },
      { path: "src/c.ts", commits: [], onDisk },
    ],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
}

function buildResult(files: WireScriptResult["files"], outcome: WireRunOutcome = WireRunOutcome.replayed): WireScriptResult {
  return { kind: "script-result", toolUseId: "toolu_1", outcome, files, stdout: "", stderr: "", timedOut: false, isOutputSaved: true };
}

function listRunPaths(view: WireLayer1View): string[] {
  const paths: string[] = [];
  for (const pair of view.pairs) {
    const carriesRun = (pair.scriptRuns ?? []).length > 0;
    if (carriesRun) {
      paths.push(pair.path);
    }
  }
  return paths;
}

function findRunOfPath(view: WireLayer1View, path: string): WireScriptRun {
  for (const pair of view.pairs) {
    const isPathMatch = pair.path === path;
    if (isPathMatch) {
      const run = (pair.scriptRuns ?? [])[0];
      if (run === undefined) {
        throw new Error(`no run on ${path}`);
      }
      return run;
    }
  }
  throw new Error(`no pair ${path}`);
}

test("test_applyReplayResultsToView_keeps_guess_dots_without_result", () => {
  // Verify: a run with no stored result stays on the files the name search chose.
  resetRunResults();
  const placed = applyReplayResultsToView(buildView());
  assert.deepEqual(listRunPaths(placed), ["src/a.ts", "src/b.ts"]);
});

test("test_applyReplayResultsToView_moves_replayed_run_to_changed_files", () => {
  // Verify: a replayed run leaves A and sits on B and C, with a rating from the result.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([
    { path: "src/b.ts", change: WireFileChange.changed, confidence: WireConfidence.verified },
    { path: "src/c.ts", change: WireFileChange.changed, confidence: WireConfidence.mismatch },
  ]));
  const placed = applyReplayResultsToView(view);
  assert.deepEqual(listRunPaths(placed), ["src/b.ts", "src/c.ts"]);
  assert.equal(findRunOfPath(placed, "src/c.ts").axisPx, 0);
  assert.equal(findRunOfPath(placed, "src/b.ts").confidence, WireConfidence.verified);
  assert.equal(findRunOfPath(placed, "src/c.ts").confidence, WireConfidence.mismatch);
});

test("test_applyReplayResultsToView_puts_a_dot_on_a_deleted_file", () => {
  // Verify: a deleted file carries the run, and the copy has no rating key.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([{ path: "src/a.ts", change: WireFileChange.deleted }]));
  const placed = applyReplayResultsToView(view);
  assert.deepEqual(listRunPaths(placed), ["src/a.ts"]);
  assert.equal("confidence" in findRunOfPath(placed, "src/a.ts"), false);
});

test("test_applyReplayResultsToView_removes_every_dot_when_replay_changed_nothing", () => {
  // Verify: a replayed run with no changed file sits on no pair.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([]));
  const placed = applyReplayResultsToView(view);
  assert.deepEqual(listRunPaths(placed), []);
});

test("test_applyReplayResultsToView_keeps_guess_dots_when_replay_failed", () => {
  // Verify: every outcome other than replayed keeps the guess dots.
  for (const outcome of [WireRunOutcome.replayFailed, WireRunOutcome.notReplayed, WireRunOutcome.originalFailed]) {
    resetRunResults();
    const view = buildView();
    storeRunResult(view, buildResult([{ path: "src/c.ts", change: WireFileChange.changed }], outcome));
    const placed = applyReplayResultsToView(view);
    assert.deepEqual(listRunPaths(placed), ["src/a.ts", "src/b.ts"]);
  }
});

test("test_applyReplayResultsToView_skips_changed_path_without_pair", () => {
  // Verify: a changed file with no pair adds nothing and does not throw.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([{ path: "src/missing.ts", change: WireFileChange.changed }]));
  const placed = applyReplayResultsToView(view);
  assert.deepEqual(placed.pairs.map((pair) => pair.path), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.deepEqual(listRunPaths(placed), []);
});

test("test_applyReplayResultsToView_returns_guess_dots_after_markRunUnreplayed", () => {
  // Verify: removing the stored result puts the run back on its guess files.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([{ path: "src/c.ts", change: WireFileChange.changed }]));
  assert.deepEqual(listRunPaths(applyReplayResultsToView(view)), ["src/c.ts"]);
  markRunUnreplayed(view, "toolu_1");
  assert.deepEqual(listRunPaths(applyReplayResultsToView(view)), ["src/a.ts", "src/b.ts"]);
});

test("test_applyReplayResultsToView_does_not_change_the_input_view", () => {
  // Verify: the call returns a new view and leaves the input as it was.
  resetRunResults();
  const view = buildView();
  storeRunResult(view, buildResult([{ path: "src/c.ts", change: WireFileChange.changed, confidence: WireConfidence.verified }]));
  const before = structuredClone(view);
  applyReplayResultsToView(view);
  assert.deepEqual(view, before);
});
