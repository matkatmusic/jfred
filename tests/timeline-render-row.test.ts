// buildTimelineRow builds one row, registers it, and wires the click to row selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { SessionEndNode } from "../webapp/views/timeline-node-types.ts";

test("test_session_end_row_registers_itself_and_click_selects_it", async () => {
  initWebappDom();
  const { buildTimelineRow } = await import("../webapp/views/timeline-render-row.ts");
  const { SESSION_END_NODE_KIND } = await import("../webapp/views/timeline-types.ts");
  const selectedIndexes: number[] = [];
  const node: SessionEndNode = { kind: SESSION_END_NODE_KIND, when: "2026-01-01T00:00:00.000Z", sessionId: "abc12345", snapshots: [] };
  const context = {
    nodes: [node],
    previewPanes: new Map(),
    nodeRows: new Map(),
    pickBoxes: new Map(),
    lineLabels: new Map(),
    laneRuns: [],
    selectTimelineRow: async (nodeIndex: number) => {
      selectedIndexes.push(nodeIndex);
    },
  };
  const row = buildTimelineRow(context as never, node, 0, "#123456");
  assert.equal(context.nodeRows.get(0), row);
  assert.equal(row.classList.contains("tl-row"), true);
  (row.querySelector(".tl-line") as HTMLElement).click();
  assert.deepEqual(selectedIndexes, [0]);
});
