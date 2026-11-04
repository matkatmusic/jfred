// Test for webapp/layer1-cut-marks.ts: the Commit mode ruler click.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { installCutMarkClick } = await import("../webapp/layer1-cut-marks.ts");
const { CUT_REFUSAL_TEXT, CutRefusal } = await import("../webapp/layer1-cut-rules.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setBase } = await import("../webapp/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-tick-events.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const COMMIT_HASH = "abcdef0123456789";

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("ruler")!.append(tick);
  storeRow(tick, { axisPx, text: "t", axisPxList: [axisPx], instants: [buildInstant(hour)] });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPx));
  for (const nodeClass of nodeClasses) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.title = COMMIT_HASH;
    node.dataset["instant"] = buildInstant(hour);
    node.style.setProperty("--axis-px", "0");
    bubble.append(node);
  }
  document.getElementById("stage")!.append(bubble);
  return tick;
}

// Fresh page: hour 1 commit, hour 2 created-only, hours 3 and 4 snapshots.
function buildPage(isArmed: boolean): HTMLElement[] {
  initLayer1Dom();
  loadJfredBranch({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] });
  setArmed(isArmed);
  installCutMarkClick();
  return [addTick(1, ["node n-commit"]), addTick(2, ["node n-disk n-created"]), addTick(3, ["node n-snap"]), addTick(4, ["node n-snap"])];
}

function listenForOwnClick(tick: HTMLElement): { count: () => number } {
  const calls = { n: 0 };
  tick.addEventListener("click", () => calls.n++);
  return { count: () => calls.n };
}

test("test_not_armed_the_click_reaches_the_tick_own_handler", () => {
  // Verify: with the mode off the capture handler returns at once.
  const [commit] = buildPage(false);
  const own = listenForOwnClick(commit!);
  commit!.click();
  assert.equal(own.count(), 1);
  assert.equal(readJfredBranch().base, undefined);
});

test("test_armed_the_click_does_not_reach_the_tick_own_handler", () => {
  // Verify: stopPropagation keeps triggerTickAction from firing.
  const [commit] = buildPage(true);
  const own = listenForOwnClick(commit!);
  commit!.click();
  assert.equal(own.count(), 0);
});

test("test_a_refusal_shows_the_exact_toast_text_and_changes_nothing", () => {
  // Verify: a created-only tick says noVerifiedNode, and no pending mark appears.
  const [, created] = buildPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  created!.click();
  const toast = document.getElementById("dtoast")!;
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]);
  assert.equal(readJfredBranch().pending, undefined);
});

test("test_with_no_base_a_non_commit_tick_says_the_base_needs_a_commit", () => {
  // Verify: the first mark must be a commit tick.
  const [, , snap] = buildPage(true);
  snap!.click();
  assert.equal(document.getElementById("dtoast")!.textContent, CUT_REFUSAL_TEXT[CutRefusal.baseNeedsCommit]);
  assert.equal(readJfredBranch().base, undefined);
});

test("test_the_first_accepted_click_sets_the_base_from_the_commit_node_title", () => {
  // Verify: the base hash is the first 8 characters of the title, and the strip shows it.
  const [commit] = buildPage(true);
  commit!.click();
  assert.deepEqual(readJfredBranch().base, { instant: buildInstant(1), shortHash: COMMIT_HASH.slice(0, 8) });
  assert.equal(document.querySelectorAll("#jfred-strip .jnode[data-entry-kind=base]").length, 1);
  assert.equal(commit!.classList.contains("cut-base"), true);
});

test("test_a_second_install_adds_no_second_listener", () => {
  // Verify: two listeners would run twice and the second run would refuse the same tick as not forward.
  const [commit] = buildPage(true);
  installCutMarkClick();
  commit!.click();
  assert.equal(readJfredBranch().base?.shortHash, COMMIT_HASH.slice(0, 8));
  assert.equal(document.getElementById("dtoast")!.hidden, true);
});

test("test_with_a_base_an_accepted_click_sets_the_pending_mark_and_opens_the_drawer", () => {
  // Verify: the message is built at mark time and the drawer shows it with a Commit button.
  const [, , snap] = buildPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  snap!.click();
  const pending = readJfredBranch().pending!;
  assert.equal(pending.instant, buildInstant(3));
  assert.match(pending.message, /^jfred: reconstruct to /);
  assert.ok(document.getElementById("drawer")!.classList.contains("open"));
  assert.notEqual(document.getElementById("jfred-commit-button"), null);
  assert.equal(snap!.classList.contains("cut-pending"), true);
});

test("test_a_later_click_moves_the_pending_mark_and_counts_skipped_beacons", () => {
  // Verify: hour 3 is skipped, so the new message says it includes 1 unmarked change.
  const [, , snap, later] = buildPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  snap!.click();
  later!.click();
  const pending = readJfredBranch().pending!;
  assert.equal(pending.instant, buildInstant(4));
  assert.match(pending.message, /includes 1 unmarked changes/);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode[data-entry-kind=pending]").length, 1);
  assert.equal(snap!.classList.contains("cut-pending"), false);
});

test("test_a_click_inside_the_open_file_list_is_left_alone", () => {
  // Verify: the capture handler ignores .tickfiles, so the file buttons keep working.
  const [commit] = buildPage(true);
  const list = document.createElement("div");
  commit!.append(list);
  list.className = "tickfiles";
  const own = listenForOwnClick(commit!);
  list.click();
  assert.equal(own.count(), 1);
  assert.equal(readJfredBranch().base, undefined);
});
