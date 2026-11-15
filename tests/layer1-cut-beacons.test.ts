// Test for webapp/layer1-cut-beacons.ts: which ruler ticks hold a verified node, and how many lie between two marks.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { buildInverseCommit, buildInverseFile, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { countSkippedBeaconTicks, isBeaconNode, readTickBeaconFacts } = await import("../webapp/layer1-components/commits-column/layer1-cut-beacons.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { collectStageBubbles } = await import("../webapp/layer1-components/ruler/layer1-ruler-click.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { buildBarFileModels } = await import("../webapp/layer1-components/bars-view/layer1-bars-model.ts");
const { listRealRulerRows } = await import("../webapp/layer1-components/bars-view/layer1-bars-ruler.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { deleteJfredBranch, setBase } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const BOTH_VIEWS = [BarsViewMode.bars, BarsViewMode.bubbles];

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

function buildCommit(hour: number, treeHash: string = `t${hour}`): InverseCommitWire {
  return buildInverseCommit({ instant: buildInstant(hour), eventType: "GitCommit", treeHash });
}

// Fresh page in the given view with no tip and no Bars models.
function setUpPage(mode: (typeof BOTH_VIEWS)[number]): void {
  initLayer1Dom();
  ensureBarsMarkup();
  setBarsViewMode(mode);
  deleteJfredBranch();
  getBarsViewState().models = [];
}

// Call after the ticks exist: the models are built against the real ruler rows.
function putBarsFiles(files: Array<[string, InverseCommitWire[]]>): void {
  getBarsViewState().models = buildBarFileModels(files.map(([file, commits]) => buildInverseFile(file, commits)), listRealRulerRows());
}

function setTipAtHour(hour: number): void {
  setBase({ instant: buildInstant(hour), shortHash: "abc1234" });
}

// A tick whose row merges several hours (oldest first in the list).
function addMergedTick(hours: number[]): HTMLElement {
  const axisPx = hours[0]! * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx, text: "t", eventCount: hours.length, axisPxList: hours.map((hour) => hour * TICK_SPACING_PX), instants: hours.map(buildInstant) });
  return tick;
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  tick.style.setProperty("--axis-px", String(axisPx));
  document.getElementById("timelineRulerComponent")!.append(tick);
  storeRow(tick, { axisPx, text: "t", eventCount: 1, axisPxList: [axisPx], instants: [buildInstant(hour)] });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPx));
  for (const nodeClass of nodeClasses) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.style.setProperty("--axis-px", "0");
    node.dataset["instant"] = buildInstant(hour);
    bubble.append(node);
  }
  document.getElementById("fileBubbleContainer")!.append(bubble);
  return tick;
}

function readFacts(tick: HTMLElement) {
  return readTickBeaconFacts(tick, collectStageBubbles());
}

test("test_a_created_node_is_not_a_beacon", () => {
  // Verify: n-disk n-created is excluded first.
  initLayer1Dom();
  const facts = readFacts(addTick(1, ["node n-disk n-created"]));
  assert.equal(facts.isBeacon, false);
});

test("test_commit_disk_snapshot_and_edit_nodes_are_beacons", () => {
  // Verify: each of the four kinds makes its tick a beacon, and only commit sets isCommit.
  initLayer1Dom();
  const commit = readFacts(addTick(1, ["node n-commit"]));
  const disk = readFacts(addTick(2, ["node n-disk"]));
  const snap = readFacts(addTick(3, ["node n-snap"]));
  const edit = readFacts(addTick(4, ["node n-edit"]));
  assert.deepEqual([commit.isBeacon, disk.isBeacon, snap.isBeacon, edit.isBeacon], [true, true, true, true]);
  assert.deepEqual([commit.isCommit, disk.isCommit, snap.isCommit, edit.isCommit], [true, false, false, false]);
});

test("test_derived_nodes_are_not_beacons", () => {
  // Verify: read, script and tool nodes never count.
  initLayer1Dom();
  const derived = ["node n-read", "node n-script", "tnode"];
  for (const [index, nodeClass] of derived.entries()) {
    assert.equal(readFacts(addTick(index + 1, [nodeClass])).isBeacon, false, nodeClass);
  }
});

test("test_a_created_node_beside_a_disk_node_still_makes_a_beacon", () => {
  // Verify: one real beacon at the row is enough.
  initLayer1Dom();
  assert.equal(readFacts(addTick(1, ["node n-disk n-created", "node n-disk"])).isBeacon, true);
});

test("test_a_hidden_kind_still_counts", () => {
  // Verify: the timelineViewControls hide class does not change the beacon fact.
  initLayer1Dom();
  assert.equal(readFacts(addTick(1, ["node n-snap kind-hidden"])).isBeacon, true);
});

test("test_the_facts_carry_the_first_row_instant", () => {
  // Verify: instantMs is the ruler row's first instant.
  initLayer1Dom();
  assert.equal(readFacts(addTick(5, ["node n-snap"])).instantMs, BASE_MS + 5 * HOUR_MS);
});

test("test_isBeaconNode_rejects_a_non_node_with_a_beacon_class", () => {
  // Verify: a label span that carries n-snap is not a node.
  initLayer1Dom();
  const label = document.createElement("span");
  label.className = "nlabel n-snap";
  assert.equal(isBeaconNode(label), false);
});

test("test_skipped_count_covers_only_ticks_strictly_between", () => {
  // Verify: ends excluded, rows where no file changed since the tip not counted.
  setUpPage(BarsViewMode.bubbles);
  addTick(1, ["node n-commit"]);
  addTick(2, ["node n-snap"]);
  addTick(3, ["node n-disk n-created"]);
  addTick(4, ["node n-disk"]);
  addTick(5, ["tnode"]);
  addTick(6, ["node n-snap"]);
  // old setup counted beacon rows (h2 and h4); the counted rows are now the changed rows h2 and h4
  putBarsFiles([["a.ts", [buildCommit(4), buildCommit(2)]]]);
  setTipAtHour(1);
  assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 6 * HOUR_MS), 2);
  assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 2 * HOUR_MS), 0);
});

test("test_in_bars_view_a_tick_reads_its_facts_from_the_bars_models", () => {
  // Step: Bars view, no bubble nodes at all. A file has a commit at h2 and a snapshot at h3.
  setUpPage(BarsViewMode.bars);
  const commitTick = addTick(2, []);
  const snapshotTick = addTick(3, []);
  const emptyTick = addTick(4, []);
  putBarsFiles([["a.ts", [buildInverseCommit({ instant: buildInstant(3), eventType: "BackupSnapshot", treeHash: "t3" }), buildCommit(2)]]]);
  // Step: the h2 row is a beacon and a commit row, the h3 row is a beacon but no commit row, the h4 row is neither.
  assert.deepEqual([readFacts(commitTick).isBeacon, readFacts(commitTick).isCommit], [true, true]);
  assert.deepEqual([readFacts(snapshotTick).isBeacon, readFacts(snapshotTick).isCommit], [true, false]);
  assert.deepEqual([readFacts(emptyTick).isBeacon, readFacts(emptyTick).isCommit], [false, false]);
});

test("test_in_bars_view_skipped_ticks_count_the_scissors_rows_strictly_between_the_two_times", () => {
  // Step: Bars view, ticks h1 to h6. A file changes at h2, h3 and h6. The tip is h1.
  setUpPage(BarsViewMode.bars);
  for (const hour of [1, 2, 3, 4, 5, 6]) {
    addTick(hour, []);
  }
  putBarsFiles([["a.ts", [buildCommit(6), buildCommit(3), buildCommit(2)]]]);
  setTipAtHour(1);
  // Step: h2 and h3 count. h1 is the tip, h6 is the mark, h4 and h5 changed nothing.
  assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 6 * HOUR_MS), 2);
  // Step: nothing lies strictly between h2 and h3.
  assert.equal(countSkippedBeaconTicks(BASE_MS + 2 * HOUR_MS, BASE_MS + 3 * HOUR_MS), 0);
});

test("test_skipped_ticks_do_not_count_a_beacon_row_where_no_file_changed_since_the_tip", () => {
  for (const mode of BOTH_VIEWS) {
    // Step: ticks h1 to h4. File a keeps the same tree at h1 and h3 (the h3 row is a beacon row with no change). File b changes at h2.
    setUpPage(mode);
    addTick(1, ["node n-commit"]);
    addTick(2, ["node n-snap"]);
    addTick(3, ["node n-commit"]);
    addTick(4, []);
    putBarsFiles([
      ["a.ts", [buildCommit(3, "t1"), buildCommit(1, "t1")]],
      ["b.ts", [buildCommit(2, "t2")]],
    ]);
    setTipAtHour(1);
    // Step: only the h2 row counts.
    assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 4 * HOUR_MS), 1, mode);
  }
});

test("test_in_bubbles_view_a_tick_reads_its_facts_from_the_bubbles_even_when_bars_models_exist", () => {
  // Step: Bubbles view. The Bars models hold a commit at h2, the bubbles hold only a read node there.
  setUpPage(BarsViewMode.bubbles);
  const tick = addTick(2, ["node n-read"]);
  putBarsFiles([["a.ts", [buildCommit(2)]]]);
  // Step: the facts follow the bubbles, so the row is no beacon row.
  assert.equal(readFacts(tick).isBeacon, false);
});

test("test_in_bubbles_view_a_tick_reads_changed_since_tip_from_the_bars_models", () => {
  // Step: Bubbles view. A file changes at h3. The tip is h1.
  setUpPage(BarsViewMode.bubbles);
  addTick(1, []);
  const unchangedTick = addTick(2, []);
  const changedTick = addTick(3, []);
  putBarsFiles([["a.ts", [buildCommit(3)]]]);
  setTipAtHour(1);
  // Step: the h3 row says changed, the h2 row says not changed.
  assert.equal(readFacts(changedTick).isChangedSinceTip, true);
  assert.equal(readFacts(unchangedTick).isChangedSinceTip, false);
});

test("test_a_merged_row_gives_its_newest_instant_as_the_instant_of_the_facts", () => {
  for (const mode of BOTH_VIEWS) {
    // Step: one row merges h4 and h5.
    setUpPage(mode);
    const mergedTick = addMergedTick([4, 5]);
    // Step: the facts time is h5, not h4.
    assert.equal(readFacts(mergedTick).instantMs, BASE_MS + 5 * HOUR_MS, mode);
  }
});

test("test_the_facts_follow_the_real_ruler_after_a_redraw", () => {
  for (const mode of BOTH_VIEWS) {
    // Step: rows h1, h2, h3. A file changes at h3. The tip is h1.
    setUpPage(mode);
    addTick(1, []);
    addTick(2, []);
    addTick(3, []);
    putBarsFiles([["a.ts", [buildCommit(3)]]]);
    setTipAtHour(1);
    // Step: redraw the real ruler with rows h1, h3, h5 and leave the Bars state alone.
    document.getElementById("timelineRulerComponent")!.replaceChildren();
    addTick(1, []);
    const redrawnChangedTick = addTick(3, []);
    const redrawnNewestTick = addTick(5, []);
    // Step: the facts follow the new rows and nothing throws.
    const changedFacts = readFacts(redrawnChangedTick);
    assert.equal(changedFacts.isChangedSinceTip, true, mode);
    assert.equal(changedFacts.instantMs, BASE_MS + 3 * HOUR_MS, mode);
    const newestFacts = readFacts(redrawnNewestTick);
    assert.equal(newestFacts.isChangedSinceTip, false, mode);
    assert.equal(newestFacts.instantMs, BASE_MS + 5 * HOUR_MS, mode);
  }
});
