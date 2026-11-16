// Per-file test for webapp/layer1-run-placement.ts: replay results decide which files carry a script run's dots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReplayResultsToView } from "../webapp/layer1-run-placement.ts";
import { resetRunResults, markRunUnreplayed, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { loadScriptRunsOnce } from "../webapp/layer1-script-runs.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";

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

const ORPHAN_EXAMPLE_PATH = "scratch/disk_only_example.py";
const ORPHAN_A_PATH = "scratch/disk_only_a.py";
const ORPHAN_B_PATH = "scratch/disk_only_b.py";
const PROGRESS = { kind: "progress", label: "reading script runs", current: 1, total: 1 };
const ORPHAN_RUN: Omit<WireScriptRun, "axisPx"> = {
  instant: "2026-07-01T10:00:00.000Z", toolUseId: "toolu_fixture_orphan_1", executorKind: "python", language: "python",
  line: 3, code: "x = 1", sessionId: "fixture-session-1", sessionFile: "/fixture/demo/projects/session-1.jsonl",
};

function buildOrphanView(orphanPaths: string[]): WireLayer1View {
  const onDisk = { instant: ORPHAN_RUN.instant, axisPx: 0 };
  const diskOrphans: WireLayer1View["diskOrphans"] = [];
  for (const path of orphanPaths) {
    diskOrphans.push({ path, instant: ORPHAN_RUN.instant, axisPx: 5 });
  }
  return { pairs: [{ path: "src/a.ts", commits: [], onDisk }], gitOrphans: [], diskOrphans, ruler: [] };
}

function buildOrphanResult(files: WireScriptResult["files"], outcome: WireRunOutcome = WireRunOutcome.replayed): WireScriptResult {
  return { kind: "script-result", toolUseId: ORPHAN_RUN.toolUseId, outcome, files, stdout: "", stderr: "", timedOut: false, isOutputSaved: true };
}

test("test_a_guess_dot_shows_on_the_disk_orphan_row_before_a_replay", async () => {
  // Scenario: a run that names a disk-only file and has no stored result puts its guess dot on that orphan row.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload holds one run under the orphan path and no results.
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: ORPHAN_EXAMPLE_PATH, scriptRuns: [ORPHAN_RUN] }], results: [] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan holds the run with the zero axis.
  const placed = applyReplayResultsToView(view);
  // RED failure: scriptRuns of the returned orphan is undefined, so the deep equal fails.
  assert.deepEqual(placed.diskOrphans[0]!.scriptRuns, [{ ...ORPHAN_RUN, axisPx: 0 }]);
});

test("test_a_replayed_run_that_changed_a_disk_orphan_puts_its_dot_on_the_orphan_row", async () => {
  // Scenario: a replayed run puts a copy with the file's rating on the orphan row it changed.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload lists the run on the orphan path and holds a replayed result that changed that path.
  const result = buildOrphanResult([{ path: ORPHAN_EXAMPLE_PATH, change: WireFileChange.changed, confidence: WireConfidence.verified }]);
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: ORPHAN_EXAMPLE_PATH, scriptRuns: [ORPHAN_RUN] }], results: [result] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan holds the run copy with the file's confidence.
  const placed = applyReplayResultsToView(view);
  // RED failure: scriptRuns of the returned orphan is undefined, so the deep equal fails.
  assert.deepEqual(placed.diskOrphans[0]!.scriptRuns, [{ ...ORPHAN_RUN, axisPx: 0, confidence: WireConfidence.verified }]);
});

test("test_a_run_on_a_view_pair_that_also_changed_a_disk_only_file_gets_a_dot_on_the_orphan_row", async () => {
  // Scenario: a replayed run named only a view pair, but its result changed a disk-only file: that orphan row gets the dot.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload lists the run on the view pair path only; the replayed result names the orphan path.
  const result = buildOrphanResult([{ path: ORPHAN_EXAMPLE_PATH, change: WireFileChange.changed, confidence: WireConfidence.verified }]);
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: "src/a.ts", scriptRuns: [ORPHAN_RUN] }], results: [result] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan holds the run copy with the file's confidence.
  const placed = applyReplayResultsToView(view);
  // RED failure: scriptRuns of the returned orphan is undefined, so the deep equal fails.
  assert.deepEqual(placed.diskOrphans[0]!.scriptRuns, [{ ...ORPHAN_RUN, axisPx: 0, confidence: WireConfidence.verified }]);
});

test("test_a_failed_run_keeps_its_guess_dot_on_the_disk_orphan_row", async () => {
  // Scenario: a run whose replay failed keeps its guess dot on the orphan row that it named.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload lists the run on the orphan path and holds a replay-failed result.
  const result = buildOrphanResult([{ path: ORPHAN_EXAMPLE_PATH, change: WireFileChange.changed }], WireRunOutcome.replayFailed);
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: ORPHAN_EXAMPLE_PATH, scriptRuns: [ORPHAN_RUN] }], results: [result] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan holds the run with the zero axis and no rating.
  const placed = applyReplayResultsToView(view);
  // RED failure: scriptRuns of the returned orphan is undefined, so the deep equal fails.
  assert.deepEqual(placed.diskOrphans[0]!.scriptRuns, [{ ...ORPHAN_RUN, axisPx: 0 }]);
});

test("test_a_replayed_run_that_changed_another_disk_orphan_than_the_one_it_named_puts_its_dot_on_the_changed_row", async () => {
  // Scenario: a run named orphan A but its replayed result changed orphan B: the dot leaves A and sits on B.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload lists the run on orphan A; the replayed result names orphan B only.
  const result = buildOrphanResult([{ path: ORPHAN_B_PATH, change: WireFileChange.changed, confidence: WireConfidence.verified }]);
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: ORPHAN_A_PATH, scriptRuns: [ORPHAN_RUN] }], results: [result] }]);
  const view = buildOrphanView([ORPHAN_A_PATH, ORPHAN_B_PATH]);
  await loadScriptRunsOnce(view);
  const placed = applyReplayResultsToView(view);
  // orphan B holds the run copy with the file's confidence.
  // RED failure: scriptRuns of the returned orphan B is undefined, so the deep equal fails.
  assert.deepEqual(placed.diskOrphans[1]!.scriptRuns, [{ ...ORPHAN_RUN, axisPx: 0, confidence: WireConfidence.verified }]);
  // orphan A has no scriptRuns: the replayed run leaves its guess dot there.
  assert.equal(placed.diskOrphans[0]!.scriptRuns, undefined);
});

test("test_a_replayed_run_that_did_not_change_the_orphan_row_removes_its_guess_dot_there", async () => {
  // Scenario: a replayed run that changed another file takes its guess dot off the orphan row; guard, passes before and after.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload lists the run on the orphan path; the replayed result names another file.
  const result = buildOrphanResult([{ path: "scratch/other_file.py", change: WireFileChange.changed }]);
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [{ path: ORPHAN_EXAMPLE_PATH, scriptRuns: [ORPHAN_RUN] }], results: [result] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan has no scriptRuns.
  const placed = applyReplayResultsToView(view);
  assert.equal(placed.diskOrphans[0]!.scriptRuns, undefined);
});

test("test_a_disk_orphan_with_no_runs_is_returned_unchanged", async () => {
  // Scenario: an orphan that no run names comes back as the same object; guard, passes before and after.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload holds no runs and no results.
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, { pairs: [], results: [] }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan is the same object as the input orphan.
  const placed = applyReplayResultsToView(view);
  assert.equal(placed.diskOrphans[0], view.diskOrphans[0]);
});

test("test_a_run_that_also_sits_on_a_view_pair_gets_no_guess_dot_on_the_disk_orphan_row", async () => {
  // Scenario: known limit: before a replay a run on a view pair gets no guess dot on a disk-only row; guard, passes before and after.
  // Steps:
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  resetRunResults();
  // the payload holds the same run under a view pair path and the orphan path, and no results.
  installStreamRoute("/api/layer1-script-runs", [PROGRESS, {
    pairs: [{ path: "src/a.ts", scriptRuns: [ORPHAN_RUN] }, { path: ORPHAN_EXAMPLE_PATH, scriptRuns: [ORPHAN_RUN] }], results: [],
  }]);
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  await loadScriptRunsOnce(view);
  // the placed orphan has no scriptRuns and is the same object as the input orphan.
  const placed = applyReplayResultsToView(view);
  assert.equal(placed.diskOrphans[0]!.scriptRuns, undefined);
  assert.equal(placed.diskOrphans[0], view.diskOrphans[0]);
});

test("test_a_disk_orphan_of_a_view_that_was_never_loaded_is_returned_unchanged", () => {
  // Scenario: a view never given to loadScriptRunsOnce is placed without a throw; guard, passes before and after.
  // Steps:
  resetRunResults();
  // a hand-built view with one orphan; loadScriptRunsOnce is never called for it.
  const view = buildOrphanView([ORPHAN_EXAMPLE_PATH]);
  // placing the view does not throw.
  let placed: WireLayer1View | undefined;
  assert.doesNotThrow(() => {
    placed = applyReplayResultsToView(view);
  });
  // the placed orphan is the same object as the input orphan.
  assert.equal(placed!.diskOrphans[0], view.diskOrphans[0]);
});
