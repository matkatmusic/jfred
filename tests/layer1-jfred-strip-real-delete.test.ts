// Test for webapp/layer1-jfred-strip.ts: the Delete click asks Yes/No first, on real and canned branches.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { DELETE_QUESTION, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { loadJfredBranch, readJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const TICKS = ["2026-06-01T09:00:00.000Z", "2026-06-03T10:30:00.000Z", "2026-06-03T18:20:00.000Z"].map((instant, index) => ({ instant, axisPx: 100 + index * 190, eventCount: 1 }));
const COMMITS = [
  { instant: TICKS[1]!.instant, shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "message one" },
  { instant: TICKS[2]!.instant, shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "message two" },
];
const REAL_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" }, commits: COMMITS } };
const CANNED_VIEW = { ...REAL_VIEW, jfredCommits: { ...REAL_VIEW.jfredCommits, isCanned: true as const } };
let sent: { pathname: string; init: RequestInit }[] = [];
let releaseDeleteReply: () => void = () => {};

beforeEach(() => {
  initLayer1Dom();
  sent = [];
  Object.assign(globalThis, {
    fetch: async (url: unknown, init: RequestInit): Promise<Response> => {
      sent.push({ pathname: new URL(String(url), "http://localhost:7343").pathname, init });
      await new Promise<void>((resolve) => { releaseDeleteReply = resolve; });
      return new Response("{}");
    },
  });
  setArmed(true);
});

async function settle(): Promise<void> {
  await waitForAsyncWork();
  await waitForAsyncWork();
}

async function clickDeleteThenAnswer(view: typeof REAL_VIEW, answerClass: string): Promise<void> {
  loadJfredBranch(view);
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfred-strip .jdelete")!.click();
  document.querySelector<HTMLElement>(answerClass)?.click();
  await settle();
}

test("test_delete_click_asks_a_yes_no_question_before_any_request", () => {
  // Verify: on a real and a canned branch alike the row shows the question and nothing else happens.
  for (const view of [REAL_VIEW, CANNED_VIEW]) {
    loadJfredBranch(view);
    renderJfredStrip(TICKS);
    document.querySelector<HTMLElement>("#jfred-strip .jdelete")!.click();
    assert.equal(document.querySelectorAll("#yesno-row").length, 1);
    assert.equal(document.querySelector("#yesno-row span")!.textContent, DELETE_QUESTION);
    assert.equal(sent.length, 0);
    assert.equal(readJfredBranch().commits.length, 2);
    document.getElementById("yesno-row")!.remove();
  }
});

test("test_delete_click_answered_no_sends_no_request_and_keeps_the_entries", async () => {
  // Verify: No closes the row, sends nothing and leaves base and both commits drawn.
  await clickDeleteThenAnswer(REAL_VIEW, ".yesno-no");
  assert.equal(document.getElementById("yesno-row"), null);
  assert.equal(sent.length, 0);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 3);
});

test("test_delete_click_answered_yes_on_a_real_branch_posts_to_the_delete_route_then_clears_the_entries", async () => {
  // Verify: Yes posts to the delete route; the entries stay until the reply arrives, then clear.
  await clickDeleteThenAnswer(REAL_VIEW, ".yesno-yes");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.pathname, "/api/layer1-jfred-delete");
  assert.equal(sent[0]!.init.method, "POST");
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 3);
  releaseDeleteReply();
  await settle();
  assert.equal(readJfredBranch().base, undefined);
  assert.equal(readJfredBranch().commits.length, 0);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 0);
  assert.equal(document.querySelectorAll("#jfred-strip .jhead").length, 1);
});

test("test_delete_click_answered_yes_on_a_real_branch_clears_the_saved_base_hash", async () => {
  // Verify: after the delete reply the settings route receives an empty base hash for the folder.
  (document.getElementById("dir") as HTMLInputElement).value = "/w/proj";
  await clickDeleteThenAnswer(REAL_VIEW, ".yesno-yes");
  releaseDeleteReply();
  await settle();
  const settingsPosts = sent.filter((request) => request.pathname === "/api/layer1-settings");
  assert.equal(settingsPosts.length, 1);
  assert.deepEqual(JSON.parse(String(settingsPosts[0]!.init.body)), { dir: "/w/proj", jfredBaseHash: "" });
});

test("test_delete_click_answered_yes_on_a_canned_branch_clears_the_entries_and_sends_no_request", async () => {
  // Verify: a canned branch clears its entries in the page and sends no request at all.
  await clickDeleteThenAnswer(CANNED_VIEW, ".yesno-yes");
  assert.equal(sent.length, 0);
  assert.equal(readJfredBranch().commits.length, 0);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 0);
});
