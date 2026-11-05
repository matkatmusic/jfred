// Per-file test for webapp/layer1-run-viewport.ts: which dots count as on screen, and the debounced scroll check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView } from "../webapp/layer1-diff-wash.ts";
import { resetRunConsent } from "../webapp/layer1-run-consent.ts";
import { resetRunQueue } from "../webapp/layer1-run-queue.ts";
import { resetRunResults } from "../webapp/layer1-run-results.ts";
import { installRunViewportWatcher, listOnScreenRunIds, type PaneBounds } from "../webapp/layer1-run-viewport.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const PANE: PaneBounds = { left: 0, top: 0, right: 100, bottom: 100 };
const DEBOUNCE_WAIT_MS = 300;

function buildDot(id: string, left: number, size: number): HTMLElement {
  const dot = createElement("i", { class: "node n-script", "data-tool-use-id": id });
  const rect = { left, top: 10, right: left + size, bottom: 10 + size, width: size, height: size };
  dot.getBoundingClientRect = () => rect as DOMRect;
  return dot;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function installNeedsFetch(): string[] {
  const urls: string[] = [];
  const stubbedFetch = async (url: unknown): Promise<Response> => {
    urls.push(String(url));
    const reply = { toolUseId: "toolu_w", needs: [] };
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) } as unknown as Response;
  };
  Object.assign(globalThis, { fetch: stubbedFetch });
  return urls;
}

test("test_listOnScreenRunIds_keeps_inside_dots_and_drops_outside_and_zero_sized_dots", () => {
  // Verify: inside stays, outside drops, a zero-sized (filter-hidden) dot drops, a run with two dots is listed once.
  const dots = [buildDot("inside", 10, 8), buildDot("outside", 200, 8), buildDot("hidden", 10, 0), buildDot("inside", 40, 8)];
  assert.deepEqual(listOnScreenRunIds(PANE, dots), ["inside"]);
});

test("test_listOnScreenRunIds_a_dot_that_only_touches_the_pane_edge_is_outside", () => {
  // Verify: the intersection is strict.
  assert.deepEqual(listOnScreenRunIds(PANE, [buildDot("edge", 100, 8), buildDot("partly", 95, 8)]), ["partly"]);
});

test("test_installRunViewportWatcher_scrolls_in_a_burst_ask_the_needs_route_once", async () => {
  // Verify: three scrolls inside the debounce window give one needs request for the one on-screen runnable dot.
  initLayer1Dom("?dir=%2Fw");
  resetRunConsent();
  resetRunQueue();
  resetRunResults();
  const run: WireScriptRun = {
    instant: "2026-07-01T10:00:00.000Z", axisPx: 0, toolUseId: "toolu_w", executorKind: "python", language: "python",
    line: 1, code: "x = 1", sessionId: "s1", sessionFile: "/logs/s1.jsonl",
  };
  const view: WireLayer1View = {
    pairs: [{ path: "a.ts", commits: [], onDisk: { instant: run.instant, axisPx: 0 }, scriptRuns: [run] }], gitOrphans: [], diskOrphans: [], ruler: [],
  };
  rememberDrawnView(view);
  const timelines = getRequiredElementById("timelines");
  timelines.getBoundingClientRect = () => PANE as DOMRect;
  getRequiredElementById("stage").replaceChildren(buildDot("toolu_w", 10, 8));
  const urls = installNeedsFetch();
  installRunViewportWatcher();
  for (let burst = 0; burst < 3; burst++) {
    timelines.dispatchEvent(new window.Event("scroll"));
  }
  await waitFor(DEBOUNCE_WAIT_MS);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /\/api\/layer1-script-needs/);
  const decline = [...document.querySelectorAll<HTMLButtonElement>(".run-consent button")].find((button) => button.textContent === "Continue without running");
  decline!.click();
  await waitFor(0);
});
