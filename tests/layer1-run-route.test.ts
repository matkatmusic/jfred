// Per-file test for webapp/layer1-run-route.ts: blocked ids, eligible ids, stale needs, and the needs cache, with a stubbed fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clearNeedsCache, computeRunRoutes, runQueueState } from "../webapp/layer1-run-route.ts";
import { getRunOutcome, isRunStarted, markRunStarted, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireNeedState, WireRunOutcome, type WireNeededRun } from "../webapp/layer1-wire-script-results.ts";
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
  resetRunResults();
  clearNeedsCache();
  runQueueState.queue = [];
  runQueueState.runningId = undefined;
}

function readPopup(): Element | null {
  return document.getElementById("run-blocked-popup");
}

test("test_computeRunRoutes_a_blocked_id_sends_no_run_request_and_shows_the_popup", async () => {
  // Verify: a listed need blocks the id; only the needs route is asked.
  resetRouteState();
  const urls = installNeedsFetch([buildNeed("far", 0)]);
  await computeRunRoutes(buildView({ "a.ts": [buildRun("blocked-id", 5)] }), ["blocked-id"]);
  assert.deepEqual(runQueueState.queue, []);
  assert.deepEqual(urls, ["/api/layer1-script-needs?dir=%2Fw"]);
  assert.notEqual(readPopup(), null);
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
  const view = buildView({ "x.ts": [held], "b.ts": [buildRun("waiting-b", 5)] });
  markRunStarted("held-a");
  storeRunResult(view, { kind: "script-result", toolUseId: "held-a", outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
  installNeedsFetch([buildNeed("held-a", 1)]);
  await computeRunRoutes(view, ["waiting-b"]);
  assert.equal(isRunStarted("held-a"), false);
  assert.equal(getRunOutcome("held-a"), undefined);
  assert.equal(held.confidence, undefined);
  assert.deepEqual(runQueueState.queue, []);
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
