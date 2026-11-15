// Test for webapp/layer1-cut-marks.ts: the Commit mode ruler click.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { buildInverseCommit, buildInverseFile, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { installCutMarkClick } = await import("../webapp/layer1-components/commits-column/layer1-cut-marks.ts");
const { CUT_REFUSAL_TEXT, CutRefusal } = await import("../webapp/layer1-components/commits-column/layer1-cut-rules.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setBase } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { buildBarFileModels } = await import("../webapp/layer1-components/bars-view/layer1-bars-model.ts");
const { listRealRulerRows } = await import("../webapp/layer1-components/bars-view/layer1-bars-ruler.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { rememberDrawnView } = await import("../webapp/layer1-components/bubbles/layer1-diff-wash.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const COMMIT_HASH = "abcdef0123456789";
const DRAWN_COMMIT_HASH = "feedface00112233";
const BOTH_VIEWS = [BarsViewMode.bars, BarsViewMode.bubbles];

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
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
    node.title = COMMIT_HASH;
    node.dataset["instant"] = buildInstant(hour);
    node.style.setProperty("--axis-px", "0");
    bubble.append(node);
  }
  document.getElementById("fileBubbleContainer")!.append(bubble);
  return tick;
}

// Fresh page: hour 1 commit, hour 2 created-only, hours 3 and 4 snapshots.
function buildPage(isArmed: boolean): HTMLElement[] {
  initLayer1Dom();
  ensureBarsMarkup();
  setBarsViewMode(BarsViewMode.bubbles);
  getBarsViewState().models = [];
  loadJfredBranch({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] });
  setArmed(isArmed);
  installCutMarkClick();
  return [addTick(1, ["node n-commit"]), addTick(2, ["node n-disk n-created"]), addTick(3, ["node n-snap"]), addTick(4, ["node n-snap"])];
}

function buildEditCommit(hour: number): InverseCommitWire {
  return buildInverseCommit({ instant: buildInstant(hour), eventType: "EditRow", treeHash: `t${hour}` });
}

// Call after the ticks exist: the models are built against the real ruler rows. File a.ts holds a git commit at hour 1 and one edit at each listed hour.
function putChangedHours(hours: number[]): void {
  const state = getBarsViewState();
  const newestFirst = [...hours].sort((a, b) => b - a);
  const commits = [...newestFirst.map(buildEditCommit), buildInverseCommit({ instant: buildInstant(1), eventType: "GitCommit", treeHash: "t1" })];
  const rows = listRealRulerRows();
  state.models = buildBarFileModels([buildInverseFile("a.ts", commits)], rows);
  state.rulerRows = rows;
}

function putDrawnCommitAtHour1(): void {
  rememberDrawnView({
    pairs: [{ path: "a.ts", commits: [{ instant: buildInstant(1), hash: DRAWN_COMMIT_HASH, axisPx: TICK_SPACING_PX }], onDisk: { instant: buildInstant(13), axisPx: 0 } }],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [],
  });
}

// The Bubbles page of buildPage, in the Bars view, with edits at hours 3 and 4.
function buildBarsPage(isArmed: boolean): HTMLElement[] {
  const ticks = buildPage(isArmed);
  setBarsViewMode(BarsViewMode.bars);
  putChangedHours([3, 4]);
  putDrawnCommitAtHour1();
  return ticks;
}

function listSelectedTickIndexes(): number[] {
  const ticks = Array.from(document.querySelectorAll("#timelineRulerComponent > .tick"));
  return ticks.flatMap((tick, index) => (tick.classList.contains("barsSelected") ? [index] : []));
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
  // Verify: a created-only tick with no changed file says noChangeSinceTip, and no pending mark appears.
  const [, created] = buildPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  created!.click();
  const toast = document.getElementById("dtoast")!;
  assert.equal(toast.hidden, false);
  // assert.equal(toast.textContent, CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]);
  assert.equal(toast.textContent, CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip]);
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
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode[data-entry-kind=base]").length, 1);
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
  putChangedHours([3, 4]);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  snap!.click();
  const pending = readJfredBranch().pending!;
  assert.equal(pending.instant, buildInstant(3));
  assert.match(pending.message, /^jfred: reconstruct to /);
  assert.ok(document.getElementById("detailsPaneContainer")!.classList.contains("open"));
  assert.notEqual(document.getElementById("jfred-commit-button"), null);
  assert.equal(snap!.classList.contains("cut-pending"), true);
});

test("test_a_later_click_moves_the_pending_mark_and_counts_skipped_beacons", () => {
  // Verify: hour 3 is skipped, so the new message says it includes 1 unmarked change.
  const [, , snap, later] = buildPage(true);
  putChangedHours([3, 4]);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  snap!.click();
  later!.click();
  const pending = readJfredBranch().pending!;
  assert.equal(pending.instant, buildInstant(4));
  assert.match(pending.message, /includes 1 unmarked changes/);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode[data-entry-kind=pending]").length, 1);
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

test("test_in_bars_view_the_first_click_on_a_commit_row_sets_the_base_with_its_hash", () => {
  // Verify: the base hash is the first 8 characters of the drawn view commit on the row, not of a bubble title.
  const [commit] = buildBarsPage(true);
  commit!.click();
  assert.deepEqual(readJfredBranch().base, { instant: buildInstant(1), shortHash: DRAWN_COMMIT_HASH.slice(0, 8) });
});

test("test_in_bars_view_a_base_click_on_a_row_with_no_commit_dot_shows_the_no_node_toast", () => {
  // Verify: with no base, the hour 2 row holds no dot, so the toast says noVerifiedNode.
  const [, noDot] = buildBarsPage(true);
  noDot!.click();
  assert.equal(document.getElementById("dtoast")!.textContent, CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]);
  assert.equal(readJfredBranch().base, undefined);
});

test("test_in_bars_view_a_click_on_a_row_with_no_changed_file_shows_the_no_change_toast", () => {
  // Verify: with a base, the hour 2 row has no changed file, so the toast says noChangeSinceTip.
  const [, noChange] = buildBarsPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  noChange!.click();
  assert.equal(document.getElementById("dtoast")!.textContent, CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip]);
  assert.equal(readJfredBranch().pending, undefined);
});

test("test_in_bars_view_a_click_on_a_row_newer_than_the_tip_sets_the_pending_mark_at_the_row_time", () => {
  // Verify: the hour 3 row has a changed file, so the pending mark is the hour 3 instant.
  const [, , changed] = buildBarsPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  changed!.click();
  assert.equal(readJfredBranch().pending?.instant, buildInstant(3));
});

test("test_in_bars_view_a_click_that_makes_a_mark_selects_that_row_and_hides_the_chunks", () => {
  // Verify: the hour 3 tick is row index 1 from the newest; it gets barsSelected and the chunks hide.
  const [, , changed] = buildBarsPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  changed!.click();
  assert.deepEqual(listSelectedTickIndexes(), [2]);
  assert.equal(getBarsViewState().selectedRowIndex, 1);
  assert.equal(document.getElementById("barsRows")!.getAttribute("data-blocks"), "hidden");
});

test("test_in_bars_view_a_second_mark_click_moves_the_selected_row", () => {
  // Verify: a click on hour 4 after hour 3 moves the selection to row index 0.
  const [, , first, second] = buildBarsPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  first!.click();
  second!.click();
  assert.deepEqual(listSelectedTickIndexes(), [3]);
  assert.equal(getBarsViewState().selectedRowIndex, 0);
});

test("test_in_bars_view_a_click_that_sets_the_base_leaves_the_selected_row_unchanged", () => {
  // Verify: setting the base selects no row.
  const [commit] = buildBarsPage(true);
  getBarsViewState().selectedRowIndex = 2;
  commit!.click();
  assert.equal(readJfredBranch().base?.shortHash, DRAWN_COMMIT_HASH.slice(0, 8));
  assert.equal(getBarsViewState().selectedRowIndex, 2);
  assert.deepEqual(listSelectedTickIndexes(), []);
});

test("test_in_bubbles_view_a_click_that_makes_a_mark_selects_no_bars_row", () => {
  // Verify: the Bubbles view makes the mark but leaves the Bars selection alone.
  const [, , changed] = buildPage(true);
  putChangedHours([3, 4]);
  getBarsViewState().selectedRowIndex = 2;
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  changed!.click();
  assert.equal(readJfredBranch().pending?.instant, buildInstant(3));
  assert.equal(getBarsViewState().selectedRowIndex, 2);
  assert.deepEqual(listSelectedTickIndexes(), []);
});

// A tick that merges hours 5 and 6 (newest row), with a snapshot bubble at hour 6 and a Bars edit at hour 6.
function addMergedNewestRow(mode: (typeof BOTH_VIEWS)[number]): HTMLElement {
  buildPage(true);
  const axisPxList = [5 * TICK_SPACING_PX, 6 * TICK_SPACING_PX];
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx: axisPxList[0]!, text: "t", eventCount: 2, axisPxList, instants: [buildInstant(5), buildInstant(6)] });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPxList[1]));
  const node = document.createElement("i");
  node.className = "node n-snap";
  node.style.setProperty("--axis-px", "0");
  bubble.append(node);
  document.getElementById("fileBubbleContainer")!.append(bubble);
  setBarsViewMode(mode);
  putChangedHours([6]);
  putDrawnCommitAtHour1();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  return tick;
}

for (const mode of BOTH_VIEWS) {
  test(`test_a_click_on_a_row_with_two_instants_sets_the_pending_mark_at_the_newest_instant_in_${mode}_view`, () => {
    // Verify: the row holds hours 5 and 6; the mark is hour 6.
    const merged = addMergedNewestRow(mode);
    merged.click();
    assert.equal(readJfredBranch().pending?.instant, buildInstant(6));
  });
}

test("test_in_bars_view_a_click_on_a_row_not_newer_than_the_tip_shows_the_not_forward_toast", () => {
  // Verify: the tip is hour 3, so the hour 2 row says notForward.
  const [, noChange] = buildBarsPage(true);
  setBase({ instant: buildInstant(3), shortHash: "a1b2c3d4" });
  noChange!.click();
  assert.equal(document.getElementById("dtoast")!.textContent, CUT_REFUSAL_TEXT[CutRefusal.notForward]);
});

test("test_in_bars_view_the_pending_message_names_the_skipped_changes_between_the_tip_and_the_mark", () => {
  // Verify: the hour 3 row is changed and lies between the tip and hour 4, so the message counts 1.
  const [, , , later] = buildBarsPage(true);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  later!.click();
  assert.match(readJfredBranch().pending!.message, /includes 1 unmarked changes/);
});

test("test_in_bars_view_a_click_while_commit_mode_is_off_sets_no_mark", () => {
  // Verify: with the mode off the click sets nothing and selects nothing.
  const [commit, , changed] = buildBarsPage(false);
  commit!.click();
  changed!.click();
  assert.equal(readJfredBranch().base, undefined);
  assert.equal(readJfredBranch().pending, undefined);
  assert.deepEqual(listSelectedTickIndexes(), []);
});
