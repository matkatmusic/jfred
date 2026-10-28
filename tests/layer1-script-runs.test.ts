// Task 356: loadScriptRunsOnce fetches /api/layer1-script-runs once per view and merges the runs into its pairs in place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScriptRunsOnce } from "../webapp/layer1-script-runs.ts";
import { stopLayer1Load } from "../webapp/layer1-progress.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const RUN = { instant: "2026-06-01T09:03:00.000Z", toolUseId: "toolu_fixture_py_rewrite", executorKind: "python", language: "python",
  code: "import pathlib", label: "python run rewrite.py", sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl" };
const PAYLOAD = { pairs: [{ path: "src/run.ts", scriptRuns: [RUN] }, { path: "not/in/the/view.ts", scriptRuns: [RUN] }] };
const PROGRESS = { kind: "progress", label: "reading script runs", current: 1, total: 1 };

function buildView(): WireLayer1View {
  const onDisk = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
  return {
    pairs: [{ path: "src/run.ts", commits: [], onDisk }, { path: "src/other.ts", commits: [], onDisk }],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
}

function isLoadbarHidden(): boolean {
  return document.getElementById("loadbar")!.hasAttribute("hidden");
}

// Wraps whatever fetch is installed, so the count survives the route stub.
function countFetchesTo(pathname: string): () => number {
  const inner = globalThis.fetch;
  let count = 0;
  Object.assign(globalThis, {
    fetch: (url: unknown, init?: RequestInit) => {
      count += String(url).includes(pathname) ? 1 : 0;
      return inner(url as string, init);
    },
  });
  return () => count;
}

test("test_loadScriptRunsOnce_merges_runs_into_the_matching_pair_with_a_zero_axis", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-script-runs", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadScriptRunsOnce(view), true);
  assert.deepEqual(view.pairs[0]!.scriptRuns, [{ ...RUN, axisPx: 0 }]);
  assert.ok(!("scriptRuns" in view.pairs[1]!));
});

test("test_loadScriptRunsOnce_asks_with_the_page_query_and_progress", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-script-runs", [PAYLOAD]);
  const urls: string[] = [];
  const inner = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    return inner(url as string, init);
  } });
  await loadScriptRunsOnce(buildView());
  assert.equal(urls[0], "/api/layer1-script-runs?dir=%2Fw&repo=%2Fw&progress=1");
});

test("test_a_second_call_for_the_same_view_never_fetches_again", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-script-runs", [PAYLOAD]);
  const fetchCount = countFetchesTo("/api/layer1-script-runs");
  const view = buildView();
  await loadScriptRunsOnce(view);
  assert.equal(await loadScriptRunsOnce(view), true);
  assert.equal(fetchCount(), 1);
  await loadScriptRunsOnce(buildView());
  assert.equal(fetchCount(), 2);
});

test("test_a_cancelled_fetch_answers_false_and_leaves_the_view_untouched", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => {
    stopLayer1Load();
    throw new Error("aborted");
  } });
  const view = buildView();
  assert.equal(await loadScriptRunsOnce(view), false);
  assert.ok(!("scriptRuns" in view.pairs[0]!));
  assert.equal(isLoadbarHidden(), true);
});

test("test_a_failed_fetch_shows_the_error_on_the_shield_and_answers_false", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
  assert.equal(await loadScriptRunsOnce(buildView()), false);
  assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), false);
  assert.match(document.getElementById("busy-error")!.textContent!, /boom/);
  assert.equal(isLoadbarHidden(), true);
});

test("test_a_success_closes_the_shield_after_the_merge", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-script-runs", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadScriptRunsOnce(view), true);
  assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), true);
  assert.equal(view.pairs[0]!.scriptRuns!.length, 1);
});
