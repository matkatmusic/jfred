// Task 343: loadEditsOnce fetches /api/layer1-edits once per view and merges the edits into its pairs in place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEditsOnce } from "../webapp/layer1-edits.ts";
import { cancelLayer1Load } from "../webapp/layer1-progress.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const EDIT = { instant: "2026-06-01T14:15:00.000Z", kind: "edit", changeId: "toolu_fixture_004", confidence: "verified",
  sessionId: "fixture-b21d84c5", sessionFile: "/fixture/demo/projects/b21d84c5.jsonl", line: 58 };
const PAYLOAD = { pairs: [{ path: "src/run.ts", edits: [EDIT] }, { path: "not/in/the/view.ts", edits: [EDIT] }] };
const PROGRESS = { kind: "progress", label: "reading Edit/Write events", current: 1, total: 1 };

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

test("test_loadEditsOnce_merges_edits_into_the_matching_pair_with_a_zero_axis", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-edits", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadEditsOnce(view), true);
  assert.deepEqual(view.pairs[0]!.edits, [{ ...EDIT, axisPx: 0 }]);
  assert.ok(!("edits" in view.pairs[1]!));
});

test("test_loadEditsOnce_asks_with_the_page_query_and_progress", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-edits", [PAYLOAD]);
  const urls: string[] = [];
  const inner = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    return inner(url as string, init);
  } });
  await loadEditsOnce(buildView());
  assert.equal(urls[0], "/api/layer1-edits?dir=%2Fw&repo=%2Fw&progress=1");
});

test("test_a_second_call_for_the_same_view_never_fetches_again", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-edits", [PAYLOAD]);
  const fetchCount = countFetchesTo("/api/layer1-edits");
  const view = buildView();
  await loadEditsOnce(view);
  assert.equal(await loadEditsOnce(view), true);
  assert.equal(fetchCount(), 1);
  await loadEditsOnce(buildView());
  assert.equal(fetchCount(), 2);
});

test("test_a_cancelled_fetch_answers_false_and_leaves_the_view_untouched", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => {
    cancelLayer1Load();
    throw new Error("aborted");
  } });
  const view = buildView();
  assert.equal(await loadEditsOnce(view), false);
  assert.ok(!("edits" in view.pairs[0]!));
  assert.equal(isLoadbarHidden(), true);
});

test("test_the_loadbar_is_hidden_after_a_success_and_after_a_failure", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-edits", [PROGRESS, PAYLOAD]);
  await loadEditsOnce(buildView());
  assert.equal(isLoadbarHidden(), true);
  Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
  assert.equal(await loadEditsOnce(buildView()), false);
  assert.equal(isLoadbarHidden(), true);
});

function isShieldHidden(): boolean {
  return document.getElementById("busy-shield")!.hasAttribute("hidden");
}

test("test_shield_is_open_before_first_await", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-edits", [PAYLOAD]);
  const loading = loadEditsOnce(buildView());
  assert.equal(isShieldHidden(), false);
  await loading;
});

test("test_failed_fetch_shows_error_on_shield_and_returns_false", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
  assert.equal(await loadEditsOnce(buildView()), false);
  assert.equal(isShieldHidden(), false);
  assert.match(document.getElementById("busy-error")!.textContent!, /boom/);
  assert.equal(document.getElementById("busy-close")!.hasAttribute("hidden"), false);
});

test("test_success_closes_shield_after_merge", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-edits", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadEditsOnce(view), true);
  assert.equal(isShieldHidden(), true);
  assert.equal(view.pairs[0]!.edits!.length, 1);
});
