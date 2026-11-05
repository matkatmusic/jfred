// Per-file test for webapp/layer1-run-results.ts: stored results, dot paint, order support, and eligibility.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import {
  appendRunOutput, getCancelledRunIds, getRunOutcome, getRunOutput, getRunResult, isRunStarted, isRunnableRun,
  markRunCancelled, markRunStarted, markRunUnreplayed, paintRunDot, paintRunDotsOfRun, resetRunResults, storeRunResult,
} from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();

const RUN: WireScriptRun = {
  instant: "2026-07-01T10:00:00.000Z", axisPx: 0, toolUseId: "toolu_1", executorKind: "python", language: "python",
  line: 3, code: "x = 1", sessionId: "s1", sessionFile: "/logs/s1.jsonl",
};

function buildView(): WireLayer1View {
  const onDisk = { instant: RUN.instant, axisPx: 0 };
  return {
    pairs: [
      { path: "src/a.ts", commits: [], onDisk, scriptRuns: [{ ...RUN }] },
      { path: "src/b.ts", commits: [], onDisk, scriptRuns: [{ ...RUN }] },
    ],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
}

function buildResult(files: WireScriptResult["files"], outcome: WireRunOutcome = WireRunOutcome.replayed): WireScriptResult {
  return { kind: "script-result", toolUseId: "toolu_1", outcome, files, stdout: "", stderr: "", timedOut: false, isOutputSaved: true };
}

function drawDots(): HTMLElement[] {
  initLayer1Dom();
  const dots: HTMLElement[] = [];
  const bubbles: HTMLElement[] = [];
  for (const path of ["src/a.ts", "src/b.ts"]) {
    const dot = createElement("i", { class: "node n-script run-state-mismatch", "data-tool-use-id": "toolu_1" });
    dots.push(dot);
    bubbles.push(createElement("div", { class: "filebox" }, [createElement("div", { class: "fname", "data-path": path }), dot]));
  }
  getRequiredElementById("stage").replaceChildren(...bubbles);
  return dots;
}

test("test_storeRunResult_paints_each_dot_with_its_own_files_class", () => {
  // Verify: a two-file run paints two different classes, and the view data holds the same confidences.
  resetRunResults();
  const dots = drawDots();
  const view = buildView();
  storeRunResult(view, buildResult([
    { path: "src/a.ts", confidence: WireConfidence.verified },
    { path: "src/b.ts", confidence: WireConfidence.injectedUnverified },
  ]));
  storeRunResult(view, buildResult([
    { path: "src/a.ts", confidence: WireConfidence.verified },
    { path: "src/b.ts", confidence: WireConfidence.injectedUnverified },
  ]));
  assert.ok(dots[0]!.classList.contains("run-state-verified"));
  assert.ok(!dots[0]!.classList.contains("run-state-mismatch"));
  assert.ok(dots[1]!.classList.contains("run-state-injected-unverified"));
  assert.equal(view.pairs[0]!.scriptRuns![0]!.confidence, WireConfidence.verified);
  assert.equal(view.pairs[1]!.scriptRuns![0]!.confidence, WireConfidence.injectedUnverified);
});

test("test_storeRunResult_adds_no_class_for_a_non_state_confidence", () => {
  // Verify: derived is written to the view but paints no run-state class, and the old class goes.
  resetRunResults();
  const dots = drawDots();
  const view = buildView();
  storeRunResult(view, buildResult([{ path: "src/a.ts", confidence: WireConfidence.derived }]));
  assert.ok(!dots[0]!.className.includes("run-state-"));
  assert.equal(view.pairs[0]!.scriptRuns![0]!.confidence, WireConfidence.derived);
});

test("test_getRunOutcome_returns_the_stored_outcome_and_undefined_before_a_start", () => {
  // Verify: each outcome is read back from the stored result.
  resetRunResults();
  const view = buildView();
  assert.equal(getRunOutcome("toolu_1"), undefined);
  for (const outcome of Object.values(WireRunOutcome)) {
    storeRunResult(view, buildResult([], outcome));
    assert.equal(getRunOutcome("toolu_1"), outcome);
  }
});

test("test_markRunUnreplayed_removes_result_mark_confidence_and_classes_but_keeps_cancel", () => {
  // Verify: the run becomes runnable and unstarted; a cancelled mark stays.
  resetRunResults();
  const dots = drawDots();
  const view = buildView();
  markRunStarted("toolu_1");
  appendRunOutput("toolu_1", "hi");
  markRunCancelled("toolu_1");
  storeRunResult(view, buildResult([{ path: "src/a.ts", confidence: WireConfidence.verified }]));
  markRunUnreplayed(view, "toolu_1");
  assert.equal(getRunResult("toolu_1"), undefined);
  assert.equal(isRunStarted("toolu_1"), false);
  assert.equal(getRunOutput("toolu_1"), "");
  assert.equal(view.pairs[0]!.scriptRuns![0]!.confidence, undefined);
  assert.ok(!dots[0]!.className.includes("run-state-"));
  assert.ok(getCancelledRunIds().has("toolu_1"));
});

test("test_appendRunOutput_joins_text_and_resetRunResults_empties_everything", () => {
  // Verify: output grows by append; reset clears started, cancelled, result and output.
  resetRunResults();
  markRunStarted("toolu_1");
  markRunCancelled("toolu_1");
  appendRunOutput("toolu_1", "a");
  appendRunOutput("toolu_1", "b");
  storeRunResult(buildView(), buildResult([]));
  assert.equal(getRunOutput("toolu_1"), "ab");
  resetRunResults();
  assert.equal(isRunStarted("toolu_1"), false);
  assert.equal(getCancelledRunIds().size, 0);
  assert.equal(getRunResult("toolu_1"), undefined);
  assert.equal(getRunOutput("toolu_1"), "");
});

test("test_isRunnableRun_needs_python_and_no_confidence", () => {
  // Verify: bash, javascript, and runs that already carry a confidence are not runnable.
  assert.equal(isRunnableRun(RUN), true);
  assert.equal(isRunnableRun({ ...RUN, language: "python3" }), true);
  assert.equal(isRunnableRun({ ...RUN, executorKind: "bash", language: "bash" }), false);
  assert.equal(isRunnableRun({ ...RUN, language: "javascript" }), false);
  assert.equal(isRunnableRun({ ...RUN, confidence: WireConfidence.verified }), false);
});

function assertDotShows(dot: HTMLElement, endClass: string, markClass: string): void {
  assert.ok(dot.classList.contains(endClass), dot.className);
  assert.equal(dot.querySelectorAll(".run-mark").length, 1);
  assert.equal(dot.querySelectorAll(`.run-mark.${markClass}`).length, 1);
}

test("test_storeRunResult_gives_every_dot_of_the_run_the_outcome_state_for_each_outcome", () => {
  // Verify: a run with no changed files shows its outcome on both dots.
  for (const outcome of Object.values(WireRunOutcome)) {
    resetRunResults();
    const dots = drawDots();
    storeRunResult(buildView(), buildResult([], outcome));
    assertDotShows(dots[0]!, `run-end-${outcome}`, `mark-${outcome}`);
    assertDotShows(dots[1]!, `run-end-${outcome}`, `mark-${outcome}`);
  }
});

test("test_storeRunResult_shows_the_rating_on_the_changed_files_dot_and_the_run_state_on_the_others", () => {
  // Verify: only src/a.ts is in result.files, so only its dot shows the rating.
  for (const rating of [WireConfidence.verified, WireConfidence.mismatch, WireConfidence.injectedUnverified, WireConfidence.originalFailed]) {
    resetRunResults();
    const dots = drawDots();
    storeRunResult(buildView(), buildResult([{ path: "src/a.ts", confidence: rating }]));
    assertDotShows(dots[0]!, "run-end-replayed", `mark-${rating}`);
    assert.ok(dots[0]!.classList.contains(`run-state-${rating}`));
    assertDotShows(dots[1]!, "run-end-replayed", "mark-replayed");
    assert.ok(!dots[1]!.className.includes("run-state-"));
  }
});

test("test_paintRunDot_shows_the_stored_state_on_a_dot_drawn_after_the_result", () => {
  // Verify: the result arrives with no dot on the page; a dot drawn later still shows the state.
  resetRunResults();
  storeRunResult(buildView(), buildResult([]));
  const lateDot = createElement("i", { class: "node n-script", "data-tool-use-id": "toolu_1" });
  paintRunDot(lateDot, undefined);
  assertDotShows(lateDot, "run-end-replayed", "mark-replayed");
});

test("test_paintRunDot_replaces_the_old_mark_when_a_dot_is_redrawn", () => {
  // Verify: painting twice leaves one mark and one end class.
  resetRunResults();
  const dot = createElement("i", { class: "node n-script", "data-tool-use-id": "toolu_1" });
  paintRunDot(dot, undefined);
  markRunStarted("toolu_1");
  paintRunDot(dot, undefined);
  assertDotShows(dot, "run-end-running", "mark-running");
  assert.ok(!dot.classList.contains("run-end-not-run"));
});

test("test_a_run_with_no_result_shows_the_not_run_default", () => {
  // Verify: no result and no start gives the ? mark.
  resetRunResults();
  const dots = drawDots();
  paintRunDot(dots[0]!, undefined);
  assertDotShows(dots[0]!, "run-end-not-run", "mark-not-run");
});

test("test_paintRunDotsOfRun_turns_every_dot_of_a_started_run_to_running", () => {
  // Verify: a started run with no result shows the running arc on each dot already on the page.
  resetRunResults();
  const dots = drawDots();
  markRunStarted("toolu_1");
  paintRunDotsOfRun("toolu_1");
  assertDotShows(dots[0]!, "run-end-running", "mark-running");
  assertDotShows(dots[1]!, "run-end-running", "mark-running");
});

test("test_paintRunDotsOfRun_turns_every_dot_of_a_cancelled_run_to_cancelled", () => {
  // Verify: cancelling a running run shows the strike on each dot.
  resetRunResults();
  const dots = drawDots();
  markRunStarted("toolu_1");
  markRunCancelled("toolu_1");
  paintRunDotsOfRun("toolu_1");
  assertDotShows(dots[0]!, "run-end-cancelled", "mark-cancelled");
  assertDotShows(dots[1]!, "run-end-cancelled", "mark-cancelled");
});

test("test_markRunUnreplayed_returns_every_dot_of_the_run_to_not_run", () => {
  // Verify: a stored result is dropped, so both dots go back to the ? mark.
  resetRunResults();
  const dots = drawDots();
  storeRunResult(buildView(), buildResult([{ path: "src/a.ts", confidence: WireConfidence.verified }]));
  markRunUnreplayed(buildView(), "toolu_1");
  assertDotShows(dots[0]!, "run-end-not-run", "mark-not-run");
  assertDotShows(dots[1]!, "run-end-not-run", "mark-not-run");
});

test("test_resetRunResults_makes_a_redrawn_dot_show_not_run", () => {
  // Verify: after clearing all results, the page reloads and redraws; a redrawn dot gets the default.
  resetRunResults();
  const dots = drawDots();
  storeRunResult(buildView(), buildResult([]));
  resetRunResults();
  paintRunDot(dots[0]!, undefined);
  assertDotShows(dots[0]!, "run-end-not-run", "mark-not-run");
});

test("test_a_bash_dot_shows_no_run_state_and_no_mark", () => {
  // Verify: a never-provable dot of the same run id keeps its look through start, result and redraw.
  resetRunResults();
  initLayer1Dom();
  const dot = createElement("i", { class: "node n-script never-provable", "data-tool-use-id": "toolu_1" });
  getRequiredElementById("stage").replaceChildren(dot);
  markRunStarted("toolu_1");
  paintRunDotsOfRun("toolu_1");
  storeRunResult(buildView(), buildResult([]));
  paintRunDot(dot, undefined);
  assert.equal(dot.className, "node n-script never-provable");
  assert.equal(dot.querySelectorAll(".run-mark").length, 0);
});
