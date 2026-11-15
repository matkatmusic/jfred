// Test for webapp/layer1-jfred-strip.ts: an `unchanged` Commit reply asks to move the mark, and the answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInverseCommit, buildInverseFile, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { buildBarFileModels } = await import("../webapp/layer1-components/bars-view/layer1-bars-model.ts");
const { listRealRulerRows } = await import("../webapp/layer1-components/bars-view/layer1-bars-ruler.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { openPendingMessage, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { installCutMarkClick } = await import("../webapp/layer1-components/commits-column/layer1-cut-marks.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setPending } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");

installCutMarkClick();
const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const WIRE_TICKS = [1, 2, 3, 4, 5, 6, 7].map((hour) => ({ instant: buildInstant(hour), axisPx: hour * 50, eventCount: 1 }));
const VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { base: { instant: buildInstant(1), shortHash: "a1b2c3d4" }, commits: [] } };
let sentPathnames: string[] = [];
let changedHours: number[] = [];

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Call after the ticks exist: the models are built against the real ruler rows. File a.ts holds one edit at each listed hour.
function putChangedHours(hours: number[]): void {
  const state = getBarsViewState();
  const newestFirst = [...hours].sort((a, b) => b - a);
  const commits = newestFirst.map((hour) => buildInverseCommit({ instant: buildInstant(hour), eventType: "EditRow", treeHash: `t${hour}` }));
  const rows = listRealRulerRows();
  state.models = buildBarFileModels([buildInverseFile("a.ts", commits)], rows);
  state.rulerRows = rows;
}

// Adds a ruler tick and its bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): void {
  const axisPx = hour * 50;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx, text: "t", eventCount: 1, axisPxList: [axisPx], instants: [buildInstant(hour)] });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPx));
  for (const nodeClass of nodeClasses) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.title = "abcdef0123456789";
    node.dataset["instant"] = buildInstant(hour);
    node.style.setProperty("--axis-px", "0");
    bubble.append(node);
  }
  document.getElementById("fileBubbleContainer")!.append(bubble);
  if (nodeClasses.length > 0) {
    changedHours.push(hour);
  }
}

async function settle(): Promise<void> {
  await waitForAsyncWork();
  await waitForAsyncWork();
}

// The needs route answers no tasks; every other route answers `reply`.
function installRoutesAnsweringWith(reply: unknown): void {
  Object.assign(globalThis, {
    fetch: async (url: unknown): Promise<Response> => {
      const { pathname } = new URL(String(url), "http://localhost:7343");
      sentPathnames.push(pathname);
      if (pathname === "/api/layer1-script-replay-needs")
        return new Response(`${JSON.stringify({ tasks: [] })}\n`);
      return new Response(`${JSON.stringify(reply)}\n`);
    },
  });
}

// Fresh page with a pending mark at hour 3; the server will answer `unchanged`.
function prepareUnchangedReply(nextHour: number | undefined): void {
  initLayer1Dom();
  sentPathnames = [];
  ensureBarsMarkup();
  setBarsViewMode(BarsViewMode.bubbles);
  getBarsViewState().models = [];
  changedHours = [];
  const reply = { outcome: "unchanged", nextInstant: nextHour === undefined ? undefined : buildInstant(nextHour) };
  installRoutesAnsweringWith(reply);
  setArmed(true);
  loadJfredBranch(VIEW);
  setPending({ instant: buildInstant(3), message: "draft message" });
}

async function clickCommit(): Promise<void> {
  if (changedHours.length > 0) {
    putChangedHours(changedHours);
  }
  renderJfredStrip(WIRE_TICKS);
  openPendingMessage();
  document.getElementById("jfred-commit-button")!.click();
  await settle();
}

test("test_an_unchanged_reply_asks_to_move_the_mark_and_changes_no_entry", async () => {
  // Verify: one row names the next instant; the pending entry and the commits stay as they were.
  prepareUnchangedReply(5);
  await clickCommit();
  assert.equal(document.querySelectorAll("#yesno-row").length, 1);
  assert.match(document.querySelector("#yesno-row span")!.textContent!, new RegExp(`Move the end mark to ${buildInstant(5)}`));
  assert.equal(readJfredBranch().pending!.instant, buildInstant(3));
  assert.equal(readJfredBranch().commits.length, 0);
  assert.deepEqual(sentPathnames, ["/api/layer1-script-replay-needs", "/api/layer1-jfred-commit"]);
});

test("test_answering_yes_moves_the_pending_mark_to_the_first_markable_tick_at_or_after_the_next_instant", async () => {
  // Verify: ticks added oldest first (the ruler order), a beacon-less one between; the mark lands on hour 6, no second request.
  prepareUnchangedReply(5);
  // addTick(7, ["node n-snap"]);
  // addTick(6, ["node n-snap"]);
  // addTick(5, []);
  // addTick(4, ["node n-snap"]);
  addTick(4, ["node n-snap"]);
  addTick(5, []);
  addTick(6, ["node n-snap"]);
  addTick(7, ["node n-snap"]);
  await clickCommit();
  document.querySelector<HTMLElement>(".yesno-yes")!.click();
  await settle();
  assert.equal(readJfredBranch().pending!.instant, buildInstant(6));
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit (pending)");
  assert.equal(document.querySelector("#dbody pre")!.textContent, readJfredBranch().pending!.message);
  assert.notEqual(document.getElementById("jfred-commit-button"), null);
  assert.deepEqual(sentPathnames, ["/api/layer1-script-replay-needs", "/api/layer1-jfred-commit"]);
});

test("test_answering_no_keeps_the_pending_mark_where_it_was", async () => {
  // Verify: No closes the row and leaves the pending mark at hour 3 with its message.
  prepareUnchangedReply(5);
  addTick(6, ["node n-snap"]);
  await clickCommit();
  document.querySelector<HTMLElement>(".yesno-no")!.click();
  await settle();
  assert.equal(document.getElementById("yesno-row"), null);
  assert.deepEqual(readJfredBranch().pending, { instant: buildInstant(3), message: "draft message" });
});

test("test_an_unchanged_reply_without_a_next_instant_shows_the_no_later_change_toast_and_no_row", async () => {
  // Verify: no next instant means a text-only toast and no question row.
  prepareUnchangedReply(undefined);
  await clickCommit();
  assert.equal(document.getElementById("yesno-row"), null);
  assert.match(document.getElementById("dtoast")!.textContent!, /no later time changes a file/);
});

test("test_unrebuilt_reply_asks_to_move_and_yes_moves_the_pending_mark", async () => {
  // Verify: the row names paths and time; Yes moves the mark to hour 6.
  prepareUnchangedReply(5);
  const reply = { outcome: "unrebuilt", paths: ["a.txt", "b.txt"], nextInstant: buildInstant(5) };
  installRoutesAnsweringWith(reply);
  addTick(6, ["node n-snap"]);
  await clickCommit();
  const questionText = document.querySelector("#yesno-row span")!.textContent!;
  assert.equal(questionText, `a.txt, b.txt could not be rebuilt here. Move the Commit point to ${buildInstant(5)}?`);
  document.querySelector<HTMLElement>(".yesno-yes")!.click();
  await settle();
  assert.equal(readJfredBranch().pending!.instant, buildInstant(6));
  assert.equal(readJfredBranch().commits.length, 0);
});

test("test_answering_yes_with_no_markable_tick_after_the_next_instant_shows_the_no_tick_toast", async () => {
  // Verify: only a tick before the next instant exists, so the mark stays and the toast explains.
  prepareUnchangedReply(5);
  addTick(4, ["node n-snap"]);
  await clickCommit();
  document.querySelector<HTMLElement>(".yesno-yes")!.click();
  await settle();
  assert.match(document.getElementById("dtoast")!.textContent!, /no ruler item can hold a mark there/);
  assert.equal(readJfredBranch().pending!.instant, buildInstant(3));
});
