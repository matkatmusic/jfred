// Per-file test for webapp/layer1-run-route.ts: blocked ids, eligible ids, stale needs, and the needs cache, with a stubbed fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberDrawnView } from "../webapp/layer1-components/bubbles/layer1-diff-wash.ts";
import { renderShowRowWithKindFilter } from "../webapp/layer1-components/show-row/layer1-kind-filter.ts";
import { clearNeedsCache, computeRunRoutes, runQueueState } from "../webapp/layer1-run-route.ts";
import { getRunOutcome, isRunStarted, markRunStarted, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireNeedState, WireRunOutcome, type WireNeededRun } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { appendBlockedDot } from "./layer1-blocked-dot-test-helpers.ts";
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

function buildNeed(id: string, minute: number): WireNeededRun {
  const { instant, sessionFile, line } = buildRun(id, minute);
  return { toolUseId: id, sessionFile, line: line!, instant, state: WireNeedState.unreplayed };
}

function installNeedsFetch(needs: WireNeededRun[]): string[] {
  const urls: string[] = [];
  const payload = { toolUseId: "t", needs };
  const reply = { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
  const readNeedsReply = async (url: unknown): Promise<Response> => {
    urls.push(String(url));
    return reply;
  };
  Object.assign(globalThis, { fetch: readNeedsReply });
  return urls;
}

function listQueuedIds(): string[] {
  const ids: string[] = [];
  for (const run of runQueueState.queue) {
    ids.push(run.toolUseId);
  }
  return ids;
}

function resetRouteState(): void {
  initLayer1Dom("?dir=%2Fw");
  for (const blockedId of ["blocked-id", "late-id", "waiting-b"]) {
    appendBlockedDot(blockedId);
  }
  resetRunResults();
  clearNeedsCache();
  runQueueState.queue = [];
  runQueueState.runningId = undefined;
}

function readPopup(): Element | null {
  return document.getElementById("run-blocked-popup");
}

// A reset redraws through the Show row, so each test draws its view first.
function drawView(view: WireLayer1View, redraw: () => void = () => {}): WireLayer1View {
  rememberDrawnView(view);
  renderShowRowWithKindFilter(view, redraw);
  return view;
}

test("test_computeRunRoutes_a_blocked_id_sends_no_run_request_and_shows_the_popup", async () => {
  // Verify: a listed need blocks the id; only the needs route is asked.
  resetRouteState();
  const urls = installNeedsFetch([buildNeed("far", 0)]);
  await computeRunRoutes(buildView({ "far.ts": [buildRun("far", 0)], "a.ts": [buildRun("blocked-id", 5)] }), ["blocked-id"]);
  assert.deepEqual(runQueueState.queue, []);
  assert.deepEqual(urls, ["/api/layer1-script-needs?dir=%2Fw"]);
  assert.notEqual(readPopup(), null);
});

test("test_computeRunRoutes_the_popup_line_names_the_file_of_the_blocker", async () => {
  // Verify: the second popup line shows the last path segment of the blocker's bubble, not its tool use id.
  resetRouteState();
  installNeedsFetch([buildNeed("far", 0)]);
  await computeRunRoutes(buildView({ "scripts/ci/module_20.tsx": [buildRun("far", 0)], "a.ts": [buildRun("blocked-id", 5)] }), ["blocked-id"]);
  assert.equal(readPopup()!.querySelector(".blocked-first")!.textContent, "module_20.tsx: not run yet");
});

test("test_computeRunRoutes_a_blocker_with_no_bubble_throws", async () => {
  // Verify: a needed run that no pair carries throws and names its id; no popup is drawn.
  resetRouteState();
  installNeedsFetch([buildNeed("far", 0)]);
  await assert.rejects(computeRunRoutes(buildView({ "a.ts": [buildRun("blocked-id", 5)] }), ["blocked-id"]), /no bubble for script far/);
  assert.equal(readPopup(), null);
});

test("test_computeRunRoutes_an_empty_needs_list_and_a_clear_own_bubble_queue_the_id", async () => {
  // Verify: no server need and no earlier dot in the bubble let the id through, with no popup.
  resetRouteState();
  installNeedsFetch([]);
  await computeRunRoutes(buildView({ "a.ts": [buildRun("clear-id", 5)] }), ["clear-id"]);
  assert.deepEqual(listQueuedIds(), ["clear-id"]);
  assert.equal(readPopup(), null);
});

test("test_computeRunRoutes_an_earlier_unreplayed_dot_in_the_own_bubble_blocks_an_empty_needs_list", async () => {
  // Verify: the own-bubble set blocks even when the server lists nothing.
  resetRouteState();
  installNeedsFetch([]);
  await computeRunRoutes(buildView({ "a.ts": [buildRun("early", 1), buildRun("late-id", 5)] }), ["late-id"]);
  assert.deepEqual(runQueueState.queue, []);
  assert.notEqual(readPopup(), null);
});

test("test_computeRunRoutes_a_listed_run_the_page_holds_as_replayed_is_marked_unreplayed", async () => {
  // Verify: run held-a loses its started mark, result, and confidence; the id stays blocked.
  resetRouteState();
  const held = buildRun("held-a", 1, { confidence: WireConfidence.verified });
  const view = drawView(buildView({ "x.ts": [held], "b.ts": [buildRun("waiting-b", 5)] }));
  markRunStarted("held-a");
  storeRunResult(view, { kind: "script-result", toolUseId: "held-a", outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
  installNeedsFetch([buildNeed("held-a", 1)]);
  await computeRunRoutes(view, ["waiting-b"]);
  assert.equal(isRunStarted("held-a"), false);
  assert.equal(getRunOutcome("held-a"), undefined);
  assert.equal(held.confidence, undefined);
  assert.deepEqual(runQueueState.queue, []);
});

test("test_computeRunRoutes_redraws_after_a_reset_need_before_routing_again", async () => {
  // Verify: no throw; one redraw restores the dot and the second pass reads the drawn view.
  resetRouteState();
  const held = buildRun("held-a", 1);
  const redrawnView = buildView({ "x.ts": [held], "b.ts": [buildRun("waiting-b", 5)] });
  let redrawCount = 0;
  const redrawIntoNewView = (): void => {
    redrawCount += 1;
    rememberDrawnView(redrawnView);
  };
  const dotlessView = drawView(buildView({ "b.ts": [buildRun("waiting-b", 5)] }), redrawIntoNewView);
  markRunStarted("held-a");
  storeRunResult(dotlessView, { kind: "script-result", toolUseId: "held-a", outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
  installNeedsFetch([buildNeed("held-a", 1)]);
  await computeRunRoutes(dotlessView, ["waiting-b"]);
  assert.equal(redrawCount, 1);
  assert.equal(isRunStarted("held-a"), false);
  assert.deepEqual(runQueueState.queue, []);
  assert.notEqual(readPopup(), null);
});
test("test_clearNeedsCache_forces_a_new_needs_request", async () => {
  // Verify: a second walk reads the cache; after the clear it asks the server again.
  resetRouteState();
  const urls = installNeedsFetch([]);
  const view = buildView({ "a.ts": [buildRun("cache-id", 5)] });
  await computeRunRoutes(view, ["cache-id"]);
  runQueueState.queue = [];
  await computeRunRoutes(view, ["cache-id"]);
  assert.equal(urls.length, 1);
  clearNeedsCache();
  runQueueState.queue = [];
  await computeRunRoutes(view, ["cache-id"]);
  assert.equal(urls.length, 2);
});
