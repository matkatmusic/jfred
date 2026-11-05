// Layer 1 lane nodes: each append function adds a dot and a label that share one axis offset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireRewindKind, type WireBranch } from "../webapp/layer1-wire-branches.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { WireScriptExecutorKind, type WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";

initLayer1Dom();
const { appendAxisNode, appendBranchLane, appendScriptRunNode, setAxisPx } = await import("../webapp/layer1-components/bubbles/layer1-lane-nodes.ts");
const { resetRunResults, storeRunResult } = await import("../webapp/layer1-run-results.ts");

const INSTANT = "2026-06-02T09:00:00.000Z";

test("test_setAxisPx_sets_the_axis_px_custom_property_and_returns_the_node", () => {
  // Scenario: one div, offset 42.
  const node = document.createElement("div");
  assert.equal(setAxisPx(node, 42), node);
  assert.equal(node.style.getPropertyValue("--axis-px"), "42");
});

test("test_appendAxisNode_adds_a_dot_and_a_label_with_the_title_and_instant", () => {
  // Scenario: a commit node with a title.
  const lane = document.createElement("div");
  appendAxisNode(lane, 10, INSTANT, "n-commit", "abc12345", "abc12345full");
  const dot = lane.querySelector("i.node.n-commit");
  const label = lane.querySelector("span.nlabel");
  assert.equal(dot?.getAttribute("title"), "abc12345full");
  assert.equal(dot?.getAttribute("data-instant"), INSTANT);
  assert.equal(label?.textContent, "abc12345");
  assert.equal((label as HTMLElement).style.getPropertyValue("--axis-px"), "10");
});

const SCRIPT_RUN = {
  toolUseId: "toolu_1",
  executorKind: WireScriptExecutorKind.python,
  language: "python",
  instant: INSTANT,
  axisPx: 10,
  code: "print(1)",
  sessionId: "s1",
  sessionFile: "s1.jsonl",
} as WireScriptRun;

test("test_appendScriptRunNode_adds_the_run_state_class_for_a_known_confidence", () => {
  // Scenario: a python run with confidence mismatch.
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, { ...SCRIPT_RUN, confidence: WireConfidence.mismatch });
  assert.ok(lane.querySelector("i.node.n-script")?.classList.contains("run-state-mismatch"));
});

test("test_appendScriptRunNode_adds_no_run_state_class_without_a_confidence", () => {
  // Scenario: a pre-execution python run.
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, SCRIPT_RUN);
  assert.ok(!(lane.querySelector("i.node.n-script")?.className ?? "").includes("run-state-"));
});

test("test_appendScriptRunNode_marks_a_bash_run_never_provable_with_no_state_class", () => {
  // Scenario: a bash run with no confidence.
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, { ...SCRIPT_RUN, executorKind: WireScriptExecutorKind.bash });
  const dot = lane.querySelector("i.node.n-script") as HTMLElement;
  assert.ok(dot.classList.contains("never-provable"));
  assert.ok(!dot.className.includes("run-state-"));
  assert.ok(!dot.className.includes("run-end-"));
  assert.equal(dot.querySelectorAll(".run-mark").length, 0);
});

test("test_appendScriptRunNode_draws_the_not_run_default_for_a_python_run_with_no_result", () => {
  // Scenario: a python run with no stored result gets the ? mark.
  resetRunResults();
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, SCRIPT_RUN);
  const dot = lane.querySelector("i.node.n-script") as HTMLElement;
  assert.ok(dot.classList.contains("run-end-not-run"));
  assert.equal(dot.querySelectorAll(".run-mark.mark-not-run").length, 1);
});

test("test_appendScriptRunNode_draws_the_stored_run_state_when_a_lane_is_redrawn", () => {
  // Scenario: the result arrived while the dot was off screen; the redraw shows the same state.
  resetRunResults();
  storeRunResult({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] }, { kind: "script-result", toolUseId: "toolu_1", outcome: WireRunOutcome.replayFailed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, SCRIPT_RUN);
  const dot = lane.querySelector("i.node.n-script") as HTMLElement;
  assert.ok(dot.classList.contains("run-end-replay-failed"));
  assert.equal(dot.querySelectorAll(".run-mark.mark-replay-failed").length, 1);
  resetRunResults();
});

test("test_appendScriptRunNode_draws_the_rating_mark_for_a_run_with_a_confidence", () => {
  // Scenario: a changed file's run carries its rating, so the redraw shows the rating mark.
  resetRunResults();
  const lane = document.createElement("div");
  appendScriptRunNode(lane, 10, { ...SCRIPT_RUN, confidence: WireConfidence.mismatch });
  const dot = lane.querySelector("i.node.n-script") as HTMLElement;
  assert.equal(dot.querySelectorAll(".run-mark.mark-mismatch").length, 1);
  assert.equal(dot.querySelectorAll(".run-mark").length, 1);
});

test("test_appendBranchLane_makes_a_lane_with_elbows_rail_and_branch_dots", () => {
  // Scenario: a code branch forking at 20, rejoining at 80, start 10: offsets are relative to start.
  const branch: WireBranch = {
    rewindKind: WireRewindKind.code,
    forkAt: { instant: INSTANT, axisPx: 20 },
    rejoinAt: { instant: INSTANT, axisPx: 80 },
    nodes: [{ instant: INSTANT, axisPx: 40, label: "[e]", changeId: "c1" }],
  } as WireBranch;
  const lane = document.createElement("div");
  appendBranchLane(lane, branch, 1, 100, 10);
  const branchLane = lane.querySelector(".blane") as HTMLElement;
  assert.equal(branchLane.style.getPropertyValue("--lane-index"), "1");
  assert.equal((branchLane.querySelector(".split-elbow") as HTMLElement).style.getPropertyValue("--axis-px"), "10");
  assert.equal((branchLane.querySelector(".merge-elbow") as HTMLElement).style.getPropertyValue("--axis-px"), "70");
  assert.equal((branchLane.querySelector(".brail") as HTMLElement).style.getPropertyValue("--span-px"), "28");
  assert.equal(branchLane.querySelector(".bnode")?.getAttribute("title"), "[e]: abandoned tip (code reverted, dead end)");
});

test("test_appendBranchLane_without_a_rejoin_ends_the_rail_at_the_last_node", () => {
  // Scenario: no rejoin: no merge elbow, and the rail ends at the last node.
  const branch = {
    rewindKind: WireRewindKind.conversation,
    forkAt: { instant: INSTANT, axisPx: 20 },
    nodes: [{ instant: INSTANT, axisPx: 60, label: "[e]", changeId: "c1" }],
  } as WireBranch;
  const lane = document.createElement("div");
  appendBranchLane(lane, branch, 2, 100, 10);
  assert.equal(lane.querySelector(".merge-elbow"), null);
  assert.equal((lane.querySelector(".brail") as HTMLElement).style.getPropertyValue("--span-px"), "24");
});
