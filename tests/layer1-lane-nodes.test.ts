// Layer 1 lane nodes: each append function adds a dot and a label that share one axis offset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireRewindKind, type WireBranch } from "../webapp/layer1-wire-branches.ts";

initLayer1Dom();
const { appendAxisNode, appendBranchLane, setAxisPx } = await import("../webapp/layer1-lane-nodes.ts");

const INSTANT = "2026-06-02T09:00:00.000Z";

test("test_setAxisPx_sets_the_axis_px_custom_property_and_returns_the_node", () => {
  // Scenario: one div, offset 42.
  const node = document.createElement("div");
  assert.equal(setAxisPx(node, 42), node);
  assert.equal(node.style.getPropertyValue("--axis-px"), "42");
});

test("test_appendAxisNode_adds_a_dot_and_a_label_with_the_title_and_instant", () => {
  // Scenario: a commit node with a title.
  const lane = document.createElement("div");
  appendAxisNode(lane, 10, INSTANT, "n-commit", "abc12345", "abc12345full");
  const dot = lane.querySelector("i.node.n-commit");
  const label = lane.querySelector("span.nlabel");
  assert.equal(dot?.getAttribute("title"), "abc12345full");
  assert.equal(dot?.getAttribute("data-instant"), INSTANT);
  assert.equal(label?.textContent, "abc12345");
  assert.equal((label as HTMLElement).style.getPropertyValue("--axis-px"), "10");
});

test("test_appendBranchLane_makes_a_lane_with_elbows_rail_and_branch_dots", () => {
  // Scenario: a code branch forking at 20, rejoining at 80, start 10: offsets are relative to start.
  const branch: WireBranch = {
    rewindKind: WireRewindKind.code,
    forkAt: { instant: INSTANT, axisPx: 20 },
    rejoinAt: { instant: INSTANT, axisPx: 80 },
    nodes: [{ instant: INSTANT, axisPx: 40, label: "[e]", changeId: "c1" }],
  } as WireBranch;
  const lane = document.createElement("div");
  appendBranchLane(lane, branch, 1, 100, 10);
  const branchLane = lane.querySelector(".blane") as HTMLElement;
  assert.equal(branchLane.style.getPropertyValue("--lane-index"), "1");
  assert.equal((branchLane.querySelector(".split-elbow") as HTMLElement).style.getPropertyValue("--axis-px"), "10");
  assert.equal((branchLane.querySelector(".merge-elbow") as HTMLElement).style.getPropertyValue("--axis-px"), "70");
  assert.equal((branchLane.querySelector(".brail") as HTMLElement).style.getPropertyValue("--span-px"), "28");
  assert.equal(branchLane.querySelector(".bnode")?.getAttribute("title"), "[e]: abandoned tip (code reverted, dead end)");
});

test("test_appendBranchLane_without_a_rejoin_ends_the_rail_at_the_last_node", () => {
  // Scenario: no rejoin: no merge elbow, and the rail ends at the last node.
  const branch = {
    rewindKind: WireRewindKind.conversation,
    forkAt: { instant: INSTANT, axisPx: 20 },
    nodes: [{ instant: INSTANT, axisPx: 60, label: "[e]", changeId: "c1" }],
  } as WireBranch;
  const lane = document.createElement("div");
  appendBranchLane(lane, branch, 2, 100, 10);
  assert.equal(lane.querySelector(".merge-elbow"), null);
  assert.equal((lane.querySelector(".brail") as HTMLElement).style.getPropertyValue("--span-px"), "24");
});
