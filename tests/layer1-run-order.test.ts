// Per-file test for webapp/layer1-run-order.ts: own-bubble blockers, the union with server needs, and the order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import {
  BlockerState, compareRunOrder, findBlockerDot, findFirstBlocker, isBlockerPending, isRunEligible,
  listOwnBubbleBlockers, listRunBubbles, mergeBlockers,
} from "../webapp/layer1-run-order.ts";
import { markRunCancelled, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireNeedState, WireRunOutcome, type WireNeededRun, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function buildRun(id: string, minute: number, overrides: Partial<WireScriptRun> = {}): WireScriptRun {
  const instant = new Date(Date.UTC(2026, 6, 1, 10, minute)).toISOString();
  return { instant, axisPx: 0, toolUseId: id, executorKind: "python", language: "python", line: 1, code: "x = 1", sessionId: "s1", sessionFile: "/logs/s1.jsonl", ...overrides };
}

function buildView(bubbles: Record<string, WireScriptRun[]>): WireLayer1View {
  const pairs: WireLayer1View["pairs"] = [];
  for (const [path, scriptRuns] of Object.entries(bubbles)) {
    pairs.push({ path, commits: [], onDisk: { instant: scriptRuns[0]!.instant, axisPx: 0 }, scriptRuns });
  }
  return { pairs, gitOrphans: [], diskOrphans: [], ruler: [] };
}

function storeOutcome(id: string, outcome: WireRunOutcome): void {
  initLayer1Dom();
  const result: WireScriptResult = { kind: "script-result", toolUseId: id, outcome, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true };
  storeRunResult(buildView({ "a.ts": [buildRun(id, 0)] }), result);
}

function buildNeed(id: string, minute: number, state: WireNeedState = WireNeedState.unreplayed): WireNeededRun {
  const { instant, sessionFile, line } = buildRun(id, minute);
  return { toolUseId: id, sessionFile, line: line!, instant, state };
}

function listIds(blockers: { toolUseId: string }[]): string[] {
  return blockers.map((blocker) => blocker.toolUseId);
}

test("test_listOwnBubbleBlockers_an_earlier_unreplayed_dot_in_the_same_bubble_blocks", () => {
  // Verify: the server list is not needed for set 1.
  resetRunResults();
  const target = buildRun("t", 5);
  const view = buildView({ "a.ts": [buildRun("e", 1), target, buildRun("later", 9)] });
  assert.deepEqual(listIds(listOwnBubbleBlockers(view, target)), ["e"]);
  assert.deepEqual(listRunBubbles(view, "t"), ["a.ts"]);
});

test("test_listOwnBubbleBlockers_an_earlier_dot_in_only_one_of_two_bubbles_still_blocks", () => {
  // Verify: bubble A is clear, bubble B holds the unreplayed earlier dot.
  resetRunResults();
  const target = buildRun("t", 5);
  const view = buildView({ "a.ts": [target], "b.ts": [buildRun("e", 1), target], "c.ts": [buildRun("other", 2)] });
  assert.deepEqual(listRunBubbles(view, "t"), ["a.ts", "b.ts"]);
  assert.deepEqual(listIds(listOwnBubbleBlockers(view, target)), ["e"]);
});

test("test_listOwnBubbleBlockers_skips_bash_javascript_and_finished_dots", () => {
  // Verify: bash, javascript, replayed, original-failed, not-replayed and fixture-done dots never block.
  resetRunResults();
  const target = buildRun("t", 9);
  const earlier = [
    buildRun("bash", 1, { executorKind: "bash", language: "bash" }), buildRun("js", 2, { language: "javascript" }),
    buildRun("replayed", 3), buildRun("failed", 4), buildRun("skipped", 5), buildRun("done", 6, { confidence: WireConfidence.verified }),
  ];
  storeOutcome("replayed", WireRunOutcome.replayed);
  storeOutcome("failed", WireRunOutcome.originalFailed);
  storeOutcome("skipped", WireRunOutcome.notReplayed);
  assert.deepEqual(listOwnBubbleBlockers(buildView({ "a.ts": [...earlier, target] }), target), []);
});

test("test_listOwnBubbleBlockers_a_crashed_dot_blocks_until_reset_and_a_cancelled_dot_reads_cancelled", () => {
  // Verify: replay-failed reads crashed; the cancelled set wins; reset makes both plain unreplayed.
  resetRunResults();
  const target = buildRun("t", 9);
  const view = buildView({ "a.ts": [buildRun("crash", 1), buildRun("cancel", 2), target] });
  storeOutcome("crash", WireRunOutcome.replayFailed);
  markRunCancelled("cancel");
  const merged = mergeBlockers(listOwnBubbleBlockers(view, target), [], new Set(["cancel"]));
  assert.deepEqual(merged.map((blocker) => blocker.state), [BlockerState.crashed, BlockerState.cancelled]);
  resetRunResults();
  const reset = mergeBlockers(listOwnBubbleBlockers(view, target), [], new Set());
  assert.deepEqual(reset.map((blocker) => blocker.state), [BlockerState.unreplayed, BlockerState.unreplayed]);
});

test("test_mergeBlockers_one_blocker_per_run_and_crashed_beats_unreplayed", () => {
  // Verify: an own blocker and a server entry for the same id give one blocker; the server adds others.
  resetRunResults();
  const own = [{ ...buildNeed("e", 1), state: BlockerState.unreplayed }];
  const needs = [buildNeed("e", 1, WireNeedState.replayFailed), buildNeed("far", 0)];
  const merged = mergeBlockers(own, needs, new Set());
  assert.deepEqual(listIds(merged), ["e", "far"]);
  assert.equal(merged[0]!.state, BlockerState.crashed);
  assert.equal(findFirstBlocker(merged)!.toolUseId, "far");
});

test("test_isRunEligible_empty_union_is_eligible_and_one_entry_blocks", () => {
  // Verify: only an empty union lets a dot run.
  resetRunResults();
  assert.equal(isRunEligible(mergeBlockers([], [], new Set())), true);
  assert.equal(isRunEligible(mergeBlockers([], [buildNeed("n", 1)], new Set())), false);
});

test("test_findFirstBlocker_orders_by_instant_then_session_file_then_line", () => {
  // Verify: the compare breaks ties in that order.
  const blockers = [
    { ...buildNeed("c", 2), state: BlockerState.unreplayed }, { ...buildNeed("b", 1), line: 7, state: BlockerState.unreplayed },
    { ...buildNeed("a", 1), line: 3, sessionFile: "/logs/s2.jsonl", state: BlockerState.unreplayed }, { ...buildNeed("z", 1), line: 3, state: BlockerState.unreplayed },
  ];
  assert.equal(findFirstBlocker(blockers)!.toolUseId, "z");
  assert.equal(findFirstBlocker([]), undefined);
  assert.ok(compareRunOrder(buildRun("x", 1, { line: 2 }), buildRun("y", 1, { line: 5 })) < 0);
});

test("test_findBlockerDot_finds_the_dot_in_a_bubble_the_blocked_run_does_not_touch", () => {
  // Verify: the lookup reads the tool use id only, not the bubble.
  initLayer1Dom();
  const dot = createElement("i", { class: "node n-script", "data-tool-use-id": "e" });
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [dot]));
  assert.equal(findBlockerDot({ ...buildNeed("e", 1), state: BlockerState.unreplayed }), dot);
  assert.equal(findBlockerDot({ ...buildNeed("none", 1), state: BlockerState.unreplayed }), undefined);
});

test("test_isBlockerPending_a_queued_or_running_blocker_needs_no_popup", () => {
  // Verify: queued and running count; others do not.
  const blocker = { ...buildNeed("e", 1), state: BlockerState.unreplayed };
  assert.equal(isBlockerPending(blocker, new Set(["e"]), undefined), true);
  assert.equal(isBlockerPending(blocker, [], "e"), true);
  assert.equal(isBlockerPending(blocker, ["x"], "y"), false);
});
