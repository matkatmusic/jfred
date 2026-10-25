// Task 357: loadBranchesOnce fetches /api/layer1-branches once per view and merges the lanes into its pairs in place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLoadedBranches, loadBranchesOnce } from "../webapp/layer1-branches.ts";
import { cancelLayer1Load } from "../webapp/layer1-progress.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const NODE = { instant: "2026-06-01T09:03:00.000Z", changeId: "toolu_lane_1", label: "edit" };
const CONVERSATION_LANE = { rewindKind: "conversation", forkAt: "2026-06-01T09:01:00.000Z", rejoinAt: "2026-06-02T09:00:00.000Z", nodes: [NODE] };
const KEPT_LANE = { rewindKind: "conversation", forkAt: "2026-06-01T09:02:00.000Z", keptToEnd: true, nodes: [NODE] };
const CODE_LANE = { rewindKind: "code", forkAt: "2026-06-01T09:04:00.000Z", nodes: [NODE] };
const PAYLOAD = { pairs: [
  { path: "src/run.ts", branches: [CONVERSATION_LANE, KEPT_LANE, CODE_LANE] },
  { path: "not/in/the/view.ts", branches: [CODE_LANE] },
] };
const PROGRESS = { kind: "progress", label: "finding branches", current: 1, total: 1 };

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

test("test_loadBranchesOnce_merges_lanes_into_the_matching_pair_with_zero_axes_and_absent_keys_stay_absent", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-branches", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadBranchesOnce(view), true);
  const [conversation, kept, code] = view.pairs[0]!.branches!;
  assert.deepEqual(conversation, { rewindKind: "conversation", forkAt: { instant: CONVERSATION_LANE.forkAt, axisPx: 0 },
    rejoinAt: { instant: CONVERSATION_LANE.rejoinAt, axisPx: 0 }, nodes: [{ ...NODE, axisPx: 0 }] });
  assert.deepEqual(kept, { rewindKind: "conversation", forkAt: { instant: KEPT_LANE.forkAt, axisPx: 0 }, keptToEnd: true, nodes: [{ ...NODE, axisPx: 0 }] });
  assert.equal("rejoinAt" in code!, false);
  assert.equal("keptToEnd" in code!, false);
  assert.ok(!("branches" in view.pairs[1]!));
});

test("test_loadBranchesOnce_asks_with_the_page_query_and_progress", async () => {
  initLayer1Dom("?dir=%2Fw&repo=%2Fw");
  stubStreamRoute("/api/layer1-branches", [PAYLOAD]);
  const urls: string[] = [];
  const inner = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    return inner(url as string, init);
  } });
  await loadBranchesOnce(buildView());
  assert.equal(urls[0], "/api/layer1-branches?dir=%2Fw&repo=%2Fw&progress=1");
});

test("test_a_second_call_for_the_same_view_never_fetches_again", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-branches", [PAYLOAD]);
  const fetchCount = countFetchesTo("/api/layer1-branches");
  const view = buildView();
  assert.equal(hasLoadedBranches(view), false);
  await loadBranchesOnce(view);
  assert.equal(hasLoadedBranches(view), true);
  assert.equal(await loadBranchesOnce(view), true);
  assert.equal(fetchCount(), 1);
  await loadBranchesOnce(buildView());
  assert.equal(fetchCount(), 2);
});

test("test_a_cancelled_fetch_answers_false_and_leaves_the_view_untouched", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => {
    cancelLayer1Load();
    throw new Error("aborted");
  } });
  const view = buildView();
  assert.equal(await loadBranchesOnce(view), false);
  assert.ok(!("branches" in view.pairs[0]!));
  assert.equal(isLoadbarHidden(), true);
});

test("test_a_failed_fetch_shows_the_error_on_the_shield_and_answers_false", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
  assert.equal(await loadBranchesOnce(buildView()), false);
  assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), false);
  assert.match(document.getElementById("busy-error")!.textContent!, /boom/);
  assert.equal(isLoadbarHidden(), true);
});

test("test_a_success_closes_the_shield_after_the_merge", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-branches", [PROGRESS, PAYLOAD]);
  const view = buildView();
  assert.equal(await loadBranchesOnce(view), true);
  assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), true);
  assert.equal(view.pairs[0]!.branches!.length, 3);
});
