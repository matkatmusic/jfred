// Test for webapp/layer1-cut-beacons.ts: which ruler ticks hold a verified node, and how many lie between two marks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { countSkippedBeaconTicks, isBeaconNode, readTickBeaconFacts } = await import("../webapp/layer1-components/commits-column/layer1-cut-beacons.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { collectStageBubbles } = await import("../webapp/layer1-components/ruler/layer1-ruler-click.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  tick.style.setProperty("--axis-px", String(axisPx));
  document.getElementById("ruler")!.append(tick);
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
  document.getElementById("stage")!.append(bubble);
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

test("test_commit_disk_and_snapshot_nodes_are_beacons", () => {
  // Verify: each of the three kinds makes its tick a beacon, and only commit sets isCommit.
  initLayer1Dom();
  const commit = readFacts(addTick(1, ["node n-commit"]));
  const disk = readFacts(addTick(2, ["node n-disk"]));
  const snap = readFacts(addTick(3, ["node n-snap"]));
  assert.deepEqual([commit.isBeacon, disk.isBeacon, snap.isBeacon], [true, true, true]);
  assert.deepEqual([commit.isCommit, disk.isCommit, snap.isCommit], [true, false, false]);
});

test("test_derived_nodes_are_not_beacons", () => {
  // Verify: edit, read, script and tool nodes never count.
  initLayer1Dom();
  const derived = ["node n-edit", "node n-read", "node n-script", "tnode"];
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
  // Verify: the show-row hide class does not change the beacon fact.
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
  // Verify: ends excluded, created-only and derived ticks not counted.
  initLayer1Dom();
  addTick(1, ["node n-commit"]);
  addTick(2, ["node n-snap"]);
  addTick(3, ["node n-disk n-created"]);
  addTick(4, ["node n-disk"]);
  addTick(5, ["tnode"]);
  addTick(6, ["node n-snap"]);
  assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 6 * HOUR_MS), 2);
  assert.equal(countSkippedBeaconTicks(BASE_MS + 1 * HOUR_MS, BASE_MS + 2 * HOUR_MS), 0);
});
