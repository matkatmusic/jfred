// Test for webapp/layer1-cut-paint.ts: the cut-mark classes and refusal titles painted on the ruler ticks.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { buildInverseCommit, buildInverseFile, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { repaintCutMarks } = await import("../webapp/layer1-components/commits-column/layer1-cut-paint.ts");
const { installCutMarkClick } = await import("../webapp/layer1-components/commits-column/layer1-cut-marks.ts");
const { CUT_REFUSAL_TEXT, CutRefusal } = await import("../webapp/layer1-components/commits-column/layer1-cut-rules.ts");
const { deleteJfredBranch, setArmed, setBase, setPending, loadJfredBranch } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { buildBarFileModels } = await import("../webapp/layer1-components/bars-view/layer1-bars-model.ts");
const { listRealRulerRows } = await import("../webapp/layer1-components/bars-view/layer1-bars-ruler.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx, text: "t", axisPxList: [axisPx], instants: [buildInstant(hour)], eventCount: 1 });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPx));
  for (const nodeClass of nodeClasses) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.style.setProperty("--axis-px", "0");
    bubble.append(node);
  }
  document.getElementById("fileBubbleContainer")!.append(bubble);
  return tick;
}

// Fresh page and empty branch; hour 1 is a commit, hour 2 a created-only tick, hour 3 a snapshot.
function buildPage(): { commit: HTMLElement; created: HTMLElement; snap: HTMLElement } {
  initLayer1Dom();
  ensureBarsMarkup();
  setBarsViewMode(BarsViewMode.bubbles);
  getBarsViewState().models = [];
  loadJfredBranch(EMPTY_VIEW);
  setArmed(false);
  return { commit: addTick(1, ["node n-commit"]), created: addTick(2, ["node n-disk n-created"]), snap: addTick(3, ["node n-snap"]) };
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

// The Bubbles page of buildPage, in the Bars view, with an edit at hour 3.
function buildBarsPage(): { commit: HTMLElement; created: HTMLElement; snap: HTMLElement } {
  const page = buildPage();
  setBarsViewMode(BarsViewMode.bars);
  putChangedHours([3]);
  return page;
}

test("test_armed_ticks_get_ok_or_no_with_the_refusal_text_as_title", () => {
  // Verify: ok for a later snapshot; no, with the refusal text, for the rest.
  const { commit, created, snap } = buildPage();
  putChangedHours([3]);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.classList.contains("cut-ok"), true);
  assert.equal(snap.title, "");
  assert.equal(created.classList.contains("cut-no"), true);
  // assert.equal(created.title, CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]);
  assert.equal(created.title, CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip]);
  assert.equal(commit.classList.contains("cut-no"), true);
  assert.equal(commit.title, CUT_REFUSAL_TEXT[CutRefusal.notForward]);
});

test("test_with_no_base_a_non_commit_beacon_says_the_base_needs_a_commit", () => {
  // Verify: the title comes from findCutRefusal, so it matches the toast text.
  const { commit, snap } = buildPage();
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.title, CUT_REFUSAL_TEXT[CutRefusal.baseNeedsCommit]);
  assert.equal(commit.classList.contains("cut-ok"), true);
});

test("test_disarming_removes_the_classes_and_titles", () => {
  // Verify: no cut class and no title is left on any tick.
  const { commit, created, snap } = buildPage();
  setArmed(true);
  repaintCutMarks();
  setArmed(false);
  repaintCutMarks();
  for (const tick of [commit, created, snap]) {
    assert.equal(tick.className, "tick");
    assert.equal(tick.hasAttribute("title"), false);
  }
});

function loadMarkedBranch(): void {
  loadJfredBranch({
    ...EMPTY_VIEW,
    jfredCommits: {
      base: { instant: buildInstant(1), shortHash: "a1b2c3d4" },
      commits: [{ instant: buildInstant(2), shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "m" }],
    },
  });
  setPending({ instant: buildInstant(3), message: "m" });
}

test("test_unarmed_paints_no_class_even_with_base_commits_and_pending", () => {
  // Verify: marks show only while Commit mode is on.
  const { commit, created, snap } = buildPage();
  loadMarkedBranch();
  repaintCutMarks();
  for (const tick of [commit, created, snap])
    assert.equal(tick.className, "tick");
});

test("test_armed_paints_base_set_and_pending_classes", () => {
  // Verify: the base tick, a committed tick and the pending tick carry their classes while armed.
  const { commit, created, snap } = buildPage();
  loadMarkedBranch();
  setArmed(true);
  repaintCutMarks();
  assert.equal(commit.classList.contains("cut-base"), true);
  assert.equal(created.classList.contains("cut-set"), true);
  assert.equal(snap.classList.contains("cut-pending"), true);
});

test("test_a_tick_with_full_time_keeps_it_as_title_when_unarmed", () => {
  // Verify: the title is the full time, restored on every repaint.
  const { snap } = buildPage();
  snap.dataset["fullTime"] = "06-01 03:00:00.000";
  repaintCutMarks();
  assert.equal(snap.title, "06-01 03:00:00.000");
});

test("test_a_tick_with_full_time_gets_refusal_then_full_time_when_armed", () => {
  // Verify: a refused tick shows the refusal text, a new line, then the time.
  const { created } = buildPage();
  created.dataset["fullTime"] = "06-01 02:00:00.000";
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  // assert.equal(created.title, `${CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]}\n06-01 02:00:00.000`);
  assert.equal(created.title, `${CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip]}\n06-01 02:00:00.000`);
});

test("test_an_accepted_armed_tick_with_full_time_keeps_the_time_title", () => {
  // Verify: an ok tick has no refusal, so its title stays the full time.
  const { snap } = buildPage();
  putChangedHours([3]);
  snap.dataset["fullTime"] = "06-01 03:00:00.000";
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.title, "06-01 03:00:00.000");
});

test("test_a_second_paint_after_the_branch_is_deleted_clears_the_state_classes", () => {
  // Verify: delete empties base, commits and pending, so no state class remains.
  const { commit } = buildPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(commit.classList.contains("cut-base"), true);
  deleteJfredBranch();
  setArmed(false);
  repaintCutMarks();
  assert.equal(commit.className, "tick");
});

test("test_in_bars_view_a_changed_row_tick_gets_cut_ok", () => {
  // Verify: the hour 3 row has an edit newer than the tip, so its tick is cut-ok.
  const { snap } = buildBarsPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.classList.contains("cut-ok"), true);
  assert.equal(snap.title, "");
});

test("test_in_bars_view_a_row_with_no_changed_file_gets_cut_no_and_the_no_change_title", () => {
  // Verify: the hour 2 row has no changed file, so its tick is cut-no with the noChangeSinceTip text.
  const { created } = buildBarsPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(created.classList.contains("cut-no"), true);
  assert.equal(created.title, CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip]);
});

// Replaces every tick of the real ruler with ticks at the given hours (one bubble-less row each).
function redrawRulerWithHours(hours: number[]): HTMLElement[] {
  document.getElementById("timelineRulerComponent")!.replaceChildren();
  return hours.map((hour) => {
    const tick = document.createElement("div");
    tick.className = "tick";
    document.getElementById("timelineRulerComponent")!.append(tick);
    storeRow(tick, { axisPx: hour * TICK_SPACING_PX, text: `h${hour}`, axisPxList: [hour * TICK_SPACING_PX], instants: [buildInstant(hour)], eventCount: 1 });
    return tick;
  });
}

test("test_scissors_are_right_after_a_ruler_redraw", () => {
  // Verify: models stay as built; after the real ruler is redrawn with other rows, the classes follow the new rows and nothing throws.
  buildBarsPage();
  putChangedHours([3, 5]);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  const [rowHour2, rowHour4, rowHour5] = redrawRulerWithHours([2, 4, 5]);
  repaintCutMarks();
  assert.equal(rowHour2!.classList.contains("cut-no"), true);
  assert.equal(rowHour4!.classList.contains("cut-ok"), true);
  assert.equal(rowHour5!.classList.contains("cut-ok"), true);
});

test("test_in_bars_view_a_click_after_a_ruler_redraw_selects_the_row_of_the_clicked_tick", () => {
  // Verify: after a redraw the clicked tick is row index 1 from the newest, and that row is selected.
  buildBarsPage();
  putChangedHours([4, 5]);
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  installCutMarkClick();
  const [, , rowHour4] = redrawRulerWithHours([1, 3, 4, 5]);
  getBarsViewState().rulerRows = listRealRulerRows();
  rowHour4!.click();
  assert.equal(getBarsViewState().selectedRowIndex, 1);
  assert.equal(rowHour4!.classList.contains("barsSelected"), true);
});

test("test_in_bars_view_the_base_row_tick_gets_cut_base", () => {
  // Verify: the class comes from the row's newest instant, in the Bars view.
  const { commit } = buildBarsPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(commit.classList.contains("cut-base"), true);
});

test("test_in_bars_view_the_pending_row_tick_gets_cut_pending", () => {
  // Verify: the pending instant matches the hour 3 row.
  const { snap } = buildBarsPage();
  loadMarkedBranch();
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.classList.contains("cut-pending"), true);
});

test("test_a_row_with_two_instants_gets_cut_base_at_its_newest_instant", () => {
  // Verify: a base at hour 6 marks the row that merges hours 5 and 6.
  buildPage();
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx: 250, text: "t", axisPxList: [250, 300], instants: [buildInstant(5), buildInstant(6)], eventCount: 2 });
  setBase({ instant: buildInstant(6), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(tick.classList.contains("cut-base"), true);
});
