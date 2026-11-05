// Per-file test for webapp/layer1-run-queue.ts: one-at-a-time walk, order, consent, cancel, needs; fetch is stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { addRunsToQueue, resetRunQueue, stopRun } from "../webapp/layer1-run-queue.ts";
import { runQueueState } from "../webapp/layer1-run-route.ts";
import { getCancelledRunIds, getRunOutcome, getRunOutput, isRunStarted, storeRunResult } from "../webapp/layer1-run-results.ts";
import { buildResult, buildRun, buildView, initPage, installServer, triggerConsent, waitAndAcceptConsent, waitFor, waitUntil } from "./layer1-run-queue-helpers.ts";

test("test_addRunsToQueue_walks_out_of_order_ids_in_time_order_one_at_a_time_and_only_once", async () => {
  // Verify: runs go earliest-first, never overlap, and a second add of started ids sends nothing.
  initPage();
  const log = installServer();
  const view = buildView({ "a.ts": [buildRun("late", 5)], "b.ts": [buildRun("early", 1)], "c.ts": [buildRun("middle", 3)] });
  await addRunsToQueue(view, ["late", "early", "middle"]);
  await waitAndAcceptConsent();
  await waitUntil(() => getRunOutcome("late") !== undefined);
  assert.deepEqual(log.runCalls, ["early", "middle", "late"]);
  assert.equal(log.maxRuns, 1);
  await addRunsToQueue(view, ["late", "early", "middle"]);
  await waitFor(30);
  assert.equal(log.runCalls.length, 3);
});

test("test_addRunsToQueue_stores_output_and_result_and_paints_the_script_runs_label", async () => {
  // Verify: output text, stored result, dot confidence, and the load bar label of the first step.
  initPage();
  const log = installServer();
  const run = buildRun("solo", 1);
  await addRunsToQueue(buildView({ "a.ts": [run] }), ["solo"]);
  await waitAndAcceptConsent();
  await waitUntil(() => getRunOutcome("solo") !== undefined);
  assert.equal(getRunOutput("solo"), "hi\n");
  assert.equal(run.confidence, "verified");
  assert.equal(log.labels[0], "script runs: 1 of 1");
});

test("test_addRunsToQueue_declined_consent_sends_no_run_request", async () => {
  // Verify: no run request goes out and nothing is marked started.
  initPage();
  const log = installServer();
  await addRunsToQueue(buildView({ "a.ts": [buildRun("declined", 1)] }), ["declined"]);
  await waitUntil(() => document.querySelector(".run-consent") !== null);
  triggerConsent("Continue without running");
  await waitFor(50);
  assert.deepEqual(log.runCalls, []);
  assert.equal(isRunStarted("declined"), false);
});

test("test_addRunsToQueue_a_later_dot_waits_for_the_run_it_needs_without_a_popup_then_runs", async () => {
  // Verify: earlier runs first, later runs after its result, and no popup shows.
  initPage();
  const log = installServer({ dependsOn: { later: ["earlier"] } });
  const view = buildView({ "a.ts": [buildRun("later", 5)], "b.ts": [buildRun("earlier", 1)] });
  await addRunsToQueue(view, ["later", "earlier"]);
  await waitAndAcceptConsent();
  await waitUntil(() => getRunOutcome("later") !== undefined);
  assert.deepEqual(log.runCalls, ["earlier", "later"]);
  assert.equal(document.getElementById("run-blocked-popup"), null);
});

test("test_addRunsToQueue_the_server_corrects_a_run_the_page_holds_as_replayed", async () => {
  // Verify: a held run the server lists as unreplayed loses its result and runs again, first.
  initPage();
  const log = installServer({ dependsOn: { later: ["held"] } });
  const view = buildView({ "a.ts": [buildRun("later", 5)], "b.ts": [buildRun("held", 1)] });
  storeRunResult(view, buildResult("held"));
  await addRunsToQueue(view, ["later", "held"]);
  await waitAndAcceptConsent();
  await waitUntil(() => getRunOutcome("later") !== undefined);
  assert.deepEqual(log.runCalls, ["held", "later"]);
});

test("test_addRunsToQueue_at_most_one_needs_request_is_in_flight", async () => {
  // Verify: two adds without waiting still ask the server one after the other.
  initPage();
  const log = installServer();
  const view = buildView({ "a.ts": [buildRun("one", 1)], "b.ts": [buildRun("two", 2)] });
  void addRunsToQueue(view, ["one"]);
  await addRunsToQueue(view, ["two"]);
  await waitAndAcceptConsent();
  await waitUntil(() => getRunOutcome("two") !== undefined);
  assert.equal(log.maxNeeds, 1);
});

test("test_addRunsToQueue_a_needs_error_shows_on_the_busy_shield_and_stops_the_walk", async () => {
  // Verify: the error text is on screen, and no run request goes out.
  initPage();
  const log = installServer({ needsStatus: 400 });
  await addRunsToQueue(buildView({ "a.ts": [buildRun("broken", 1)] }), ["broken"]);
  assert.match(document.getElementById("busy-error")!.textContent!, /needs route broke/);
  assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), false);
  assert.deepEqual(log.runCalls, []);
});

test("test_stopRun_cancels_the_running_script_and_it_is_not_retried", async () => {
  // Verify: the cancel marks the run, and the recheck sends no second run request.
  initPage();
  const log = installServer({ holdRuns: true });
  await addRunsToQueue(buildView({ "a.ts": [buildRun("slow", 1)] }), ["slow"]);
  await waitAndAcceptConsent();
  await waitUntil(() => log.runCalls.length === 1);
  stopRun("slow");
  await waitFor(50);
  assert.equal(getCancelledRunIds().has("slow"), true);
  assert.equal(log.runCalls.length, 1);
  assert.throws(() => stopRun("slow"), /not running/);
});

function drawRunDotOnPage(id: string): HTMLElement {
  const dot = createElement("i", { class: "node n-script", "data-tool-use-id": id });
  getRequiredElementById("stage").replaceChildren(dot);
  return dot;
}

test("test_addRunsToQueue_shows_the_running_mark_on_the_dots_while_the_script_runs", async () => {
  // Verify: a dot already on the page turns to the running arc when its run starts.
  initPage();
  const log = installServer({ holdRuns: true });
  const dot = drawRunDotOnPage("slow");
  await addRunsToQueue(buildView({ "a.ts": [buildRun("slow", 1)] }), ["slow"]);
  await waitAndAcceptConsent();
  await waitUntil(() => log.runCalls.length === 1);
  assert.ok(dot.classList.contains("run-end-running"));
  assert.equal(dot.querySelectorAll(".run-mark.mark-running").length, 1);
  resetRunQueue();
});

test("test_stopRun_shows_the_cancelled_mark_on_the_dots", async () => {
  // Verify: a dot already on the page turns to the strike when its run is cancelled.
  initPage();
  const log = installServer({ holdRuns: true });
  const dot = drawRunDotOnPage("slow");
  await addRunsToQueue(buildView({ "a.ts": [buildRun("slow", 1)] }), ["slow"]);
  await waitAndAcceptConsent();
  await waitUntil(() => log.runCalls.length === 1);
  stopRun("slow");
  assert.ok(dot.classList.contains("run-end-cancelled"));
  assert.equal(dot.querySelectorAll(".run-mark.mark-cancelled").length, 1);
});

test("test_resetRunQueue_aborts_the_running_script_and_does_not_throw_when_none_runs", async () => {
  // Verify: the held run ends as cancelled with no second run request, and an idle reset is quiet.
  initPage();
  const log = installServer({ holdRuns: true });
  await addRunsToQueue(buildView({ "a.ts": [buildRun("slow", 1)] }), ["slow"]);
  await waitAndAcceptConsent();
  await waitUntil(() => log.runCalls.length === 1);
  assert.equal(runQueueState.runningId, "slow");
  resetRunQueue();
  await waitUntil(() => runQueueState.runningId === undefined);
  assert.equal(log.runCalls.length, 1);
  assert.doesNotThrow(resetRunQueue);
});
