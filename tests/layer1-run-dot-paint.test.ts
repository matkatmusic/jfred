// Per-file test for the file-change marks of run dots: deleted, not text, repaint after a redraw, and runnable state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { isRunnableRun, refreshAllStoredRunDots, renderRunDotsOfRun, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
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
    const dot = createElement("i", { class: "node n-script", "data-tool-use-id": "toolu_1" });
    dots.push(dot);
    bubbles.push(createElement("div", { class: "filebox" }, [createElement("div", { class: "fname", "data-path": path }), dot]));
  }
  getRequiredElementById("stage").replaceChildren(...bubbles);
  return dots;
}

function listRunStateClasses(dot: HTMLElement): string[] {
  return [...dot.classList].filter((className) => className.startsWith("run-state-"));
}

test("test_renderRunDotsOfRun_shows_the_deleted_mark_on_a_deleted_file_dot", () => {
  // Verify: a deleted file's dot shows mark-deleted and no rating class; the other file's dot keeps its rating mark.
  resetRunResults();
  const dots = drawDots();
  storeRunResult(buildView(), buildResult([
    { path: "src/a.ts", change: WireFileChange.deleted },
    { path: "src/b.ts", change: WireFileChange.changed, confidence: WireConfidence.verified },
  ]));
  renderRunDotsOfRun("toolu_1");
  assert.equal(dots[0]!.querySelectorAll(".run-mark").length, 1);
  assert.ok(dots[0]!.querySelector(".run-mark.mark-deleted"));
  assert.deepEqual(listRunStateClasses(dots[0]!), []);
  assert.ok(dots[1]!.querySelector(".run-mark.mark-verified"));
  assert.ok(!dots[1]!.querySelector(".run-mark.mark-deleted"));
});

test("test_renderRunDotsOfRun_shows_the_not_text_mark_on_a_changed_not_text_file_dot", () => {
  // Verify: a changed-not-text file's dot shows mark-changed-not-text and no rating class.
  resetRunResults();
  const dots = drawDots();
  storeRunResult(buildView(), buildResult([{ path: "src/a.ts", change: WireFileChange.changedNotText }]));
  renderRunDotsOfRun("toolu_1");
  assert.equal(dots[0]!.querySelectorAll(".run-mark").length, 1);
  assert.ok(dots[0]!.querySelector(".run-mark.mark-changed-not-text"));
  assert.deepEqual(listRunStateClasses(dots[0]!), []);
});

test("test_refreshAllStoredRunDots_keeps_the_rating_mark_after_a_redraw", () => {
  // Verify: dots rebuilt by a redraw have no mark; refreshAllStoredRunDots puts the stored rating back on them.
  resetRunResults();
  const firstDots = drawDots();
  storeRunResult(buildView(), buildResult([{ path: "src/a.ts", change: WireFileChange.changed, confidence: WireConfidence.verified }]));
  assert.ok(firstDots[0]!.querySelector(".run-mark.mark-verified"));
  const redrawnDots = drawDots();
  assert.equal(redrawnDots[0]!.querySelectorAll(".run-mark").length, 0);
  refreshAllStoredRunDots();
  assert.ok(redrawnDots[0]!.querySelector(".run-mark.mark-verified"));
  assert.ok(redrawnDots[0]!.classList.contains("run-state-verified"));
});

test("test_isRunnableRun_is_false_for_a_replayed_run", () => {
  // Verify: a replayed run is not runnable, even when its placed copy has no confidence (a deleted file).
  resetRunResults();
  assert.equal(isRunnableRun(RUN), true);
  storeRunResult(buildView(), buildResult([{ path: "src/a.ts", change: WireFileChange.deleted }]));
  assert.equal(isRunnableRun(RUN), false);
});

test("test_isRunnableRun_stays_true_for_a_replay_failed_run", () => {
  // Verify: a replay-failed run stays runnable after its result is stored.
  resetRunResults();
  storeRunResult(buildView(), buildResult([], WireRunOutcome.replayFailed));
  assert.equal(isRunnableRun(RUN), true);
});
