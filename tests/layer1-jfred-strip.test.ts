// Test for webapp/layer1-jfred-strip.ts: the commit column beside the session column, its delete button and entry clicks.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { openPendingMessage, renderJfredEntries, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setPending } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const TICKS: WireRulerTick[] = [
  { instant: "2026-06-01T09:00:00.000Z", axisPx: 100, eventCount: 1 },
  { instant: "2026-06-01T09:05:00.000Z", axisPx: 160, eventCount: 1 },
  { instant: "2026-06-03T10:30:00.000Z", axisPx: 400, eventCount: 1 },
  { instant: "2026-06-03T18:20:00.000Z", axisPx: 480, eventCount: 1 },
];
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW = {
  ...EMPTY_VIEW,
  jfredCommits: {
    isCanned: true as const,
    base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" },
    commits: [
      { instant: TICKS[1]!.instant, shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "message one" },
      { instant: TICKS[2]!.instant, shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "message two" },
    ],
  },
};

beforeEach(() => {
  initLayer1Dom();
  loadJfredBranch(CANNED_VIEW);
  setArmed(true);
});

function addAnnotationTrack(): HTMLElement {
  const track = document.createElement("div");
  track.id = "annotation-track";
  document.getElementById("ruler")!.after(track);
  return track;
}

function findEntry(shortHashOrKind: string): HTMLElement {
  return document.querySelector<HTMLElement>(`#jfred-strip [data-short-hash="${shortHashOrKind}"], #jfred-strip [data-entry-kind="${shortHashOrKind}"]`)!;
}

test("test_the_strip_is_the_sibling_right_after_the_session_column", () => {
  // Verify: with a track present, the strip sits right after it.
  const track = addAnnotationTrack();
  renderJfredStrip(TICKS);
  assert.equal(track.nextElementSibling!.id, "jfred-strip");
});

test("test_without_a_session_column_the_strip_follows_the_ruler", () => {
  // Verify: the ruler is the anchor when no track exists.
  renderJfredStrip(TICKS);
  assert.equal(document.getElementById("ruler")!.nextElementSibling!.id, "jfred-strip");
});

test("test_a_second_render_keeps_one_strip_with_one_head", () => {
  // Verify: the strip is built once; the second render only redraws it.
  renderJfredStrip(TICKS);
  renderJfredStrip(TICKS);
  assert.equal(document.querySelectorAll("#jfred-strip").length, 1);
  assert.equal(document.querySelectorAll("#jfred-strip .jhead").length, 1);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 3);
});

test("test_the_head_holds_the_title_and_the_delete_button", () => {
  // Verify: the head reads `commits` and carries `Delete jfred branch`.
  renderJfredStrip(TICKS);
  assert.equal(document.querySelector("#jfred-strip .jhead span")!.textContent, "commits");
  assert.equal(document.querySelector("#jfred-strip .jhead button.jdelete")!.textContent, "Delete jfred branch");
});

test("test_commit_mode_off_removes_the_strip", () => {
  // Verify: with Commit mode off the next render removes the strip.
  renderJfredStrip(TICKS);
  setArmed(false);
  renderJfredStrip(TICKS);
  assert.equal(document.getElementById("jfred-strip"), null);
});

test("test_the_delete_button_clears_the_state_and_keeps_the_head", async () => {
  // Verify: after the Yes answer, base, commits and pending are gone, no entry is drawn, the head stays.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfred-strip .jdelete")!.click();
  document.querySelector<HTMLElement>("#yesno-row .yesno-yes")!.click();
  await waitForAsyncWork();
  const branch = readJfredBranch();
  assert.equal(branch.base, undefined);
  assert.equal(branch.commits.length, 0);
  assert.equal(document.querySelectorAll("#jfred-strip .jhead").length, 1);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 0);
});

test("test_a_click_on_a_commit_entry_opens_its_message_without_a_button", () => {
  // Verify: the drawer shows the stored message, header and parent.
  renderJfredStrip(TICKS);
  findEntry("c0ffee02").click();
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit c0ffee02");
  assert.equal(document.getElementById("dmeta")!.textContent, "parent c0ffee01 | author date 2026-06-03T10:30:00.000Z");
  assert.equal(document.querySelector("#dbody pre")!.textContent, "message two");
  assert.equal(document.getElementById("jfred-commit-button"), null);
});

test("test_a_click_on_a_label_opens_the_same_message", () => {
  // Verify: the delegated click works from the label too.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>('#jfred-strip .jlabel[data-short-hash="c0ffee01"]')!.click();
  assert.equal(document.querySelector("#dbody pre")!.textContent, "message one");
});

test("test_a_click_on_the_pending_entry_opens_its_message_with_a_commit_button", () => {
  // Verify: the pending draft shows with the Commit button and the tip as parent.
  setPending({ instant: TICKS[3]!.instant, message: "draft message" });
  renderJfredStrip(TICKS);
  findEntry("pending").click();
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit (pending)");
  assert.equal(document.getElementById("dmeta")!.textContent, "parent c0ffee02 | author date 2026-06-03T18:20:00.000Z");
  assert.equal(document.querySelector("#dbody pre")!.textContent, "draft message");
  assert.notEqual(document.getElementById("jfred-commit-button"), null);
});

test("test_the_commit_button_adds_the_entry_and_the_drawer_shows_it_without_a_button", async () => {
  // Verify: Commit posts, the streamed reply adds c0ffee03 with parent c0ffee02, redraws the column and drops the button.
  installStreamRoute("/api/layer1-jfred-commit", [
    { outcome: "committed", commit: { instant: TICKS[3]!.instant, shortHash: "c0ffee03", parentShortHash: "c0ffee02", message: "draft message" } },
  ]);
  setPending({ instant: TICKS[3]!.instant, message: "draft message" });
  renderJfredStrip(TICKS);
  openPendingMessage();
  document.getElementById("jfred-commit-button")!.click();
  await waitForAsyncWork();
  assert.equal(readJfredBranch().commits.at(-1)!.shortHash, "c0ffee03");
  assert.equal(findEntry("c0ffee03").dataset["parentHash"], "c0ffee02");
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 4);
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit c0ffee03");
  assert.equal(document.getElementById("jfred-commit-button"), null);
});

test("test_a_click_on_the_base_opens_nothing", () => {
  // Verify: the base has no message, so the drawer stays closed.
  renderJfredStrip(TICKS);
  findEntry("base").click();
  assert.equal(document.getElementById("drawer")!.classList.contains("open"), false);
});

test("test_redraw_builds_the_strip_from_the_stored_ticks", async () => {
  // Verify: after a delete, a new base plus a redraw brings the entry back without new ticks.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfred-strip .jdelete")!.click();
  document.querySelector<HTMLElement>("#yesno-row .yesno-yes")!.click();
  await waitForAsyncWork();
  loadJfredBranch(CANNED_VIEW);
  renderJfredEntries();
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 3);
});
