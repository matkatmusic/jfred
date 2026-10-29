// Pick cells, selectbar summary text, and the illegal-pick rule flash, driven through a fresh happy-dom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { TimelineRenderContext } from "../webapp/views/timeline-render-context.ts";
import type { TimelineNode } from "../webapp/views/timeline-node-types.ts";

async function loadPickbarModule() {
  initWebappDom();
  return import("../webapp/views/timeline-render-pickbar.ts");
}

function makeTurn(snapshotIndex: number, path: string): TimelineNode {
  return {
    kind: AGENT_TURN_NODE_KIND,
    isOrphaned: false,
    snapshots: [{ index: snapshotIndex }],
    fileChanges: [{ path }],
  } as unknown as TimelineNode;
}

function makeContext(nodes: TimelineNode[]): TimelineRenderContext {
  return {
    project: "demo",
    nodes,
    pickBoxes: new Map(),
    nodeRows: new Map(),
    pickedIndexes: [],
    selectbar: document.createElement("div"),
    barText: document.createElement("span"),
    ruleHint: document.createElement("span"),
  } as unknown as TimelineRenderContext;
}

test("test_buildPickCell_adds_a_checkbox_only_for_pickable_nodes", async () => {
  const { buildPickCell } = await loadPickbarModule();
  const commit = { kind: COMMIT_NODE_KIND } as unknown as TimelineNode;
  const context = makeContext([makeTurn(1, "a.ts"), commit]);
  const turnCell = buildPickCell(context, context.nodes[0]!, 0);
  const commitCell = buildPickCell(context, context.nodes[1]!, 1);
  assert.equal(turnCell.querySelectorAll("input").length, 1);
  assert.equal(commitCell.querySelectorAll("input").length, 0);
  assert.deepEqual([...context.pickBoxes.keys()], [0]);
});

test("test_updateSelectbar_shows_the_bar_with_step_and_file_counts", async () => {
  const { buildPickCell, updateSelectbar } = await loadPickbarModule();
  const context = makeContext([makeTurn(1, "a.ts"), makeTurn(2, "a.ts")]);
  buildPickCell(context, context.nodes[0]!, 0);
  buildPickCell(context, context.nodes[1]!, 1);
  context.pickBoxes.get(0)!.checked = true;
  context.pickBoxes.get(1)!.checked = true;
  updateSelectbar(context);
  assert.deepEqual(context.pickedIndexes, [0, 1]);
  assert.equal(context.selectbar.classList.contains("visible"), true);
  assert.equal(context.barText.textContent, "2 steps picked · 1 file");
});

test("test_pick_change_that_skips_a_turn_is_reverted_and_flashes_the_rule", async () => {
  const { buildPickCell } = await loadPickbarModule();
  const context = makeContext([makeTurn(1, "a.ts"), makeTurn(2, "b.ts"), makeTurn(3, "c.ts")]);
  const boxes: HTMLInputElement[] = [];
  for (let index = 0; index < 3; index += 1) {
    const cell = buildPickCell(context, context.nodes[index]!, index);
    boxes.push(cell.querySelector("input")!);
  }
  boxes[0]!.checked = true;
  boxes[0]!.dispatchEvent(new window.Event("change"));
  boxes[2]!.checked = true;
  boxes[2]!.dispatchEvent(new window.Event("change"));
  assert.equal(boxes[2]!.checked, false);
  assert.equal(context.ruleHint.classList.contains("show"), true);
  assert.deepEqual(context.pickedIndexes, [0]);
});
