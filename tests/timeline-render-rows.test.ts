// buildTimelineRows appends one row per node to the container.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_build_timeline_rows_appends_one_row_per_node", async () => {
  initWebappDom();
  const { buildTimelineRows } = await import("../webapp/views/timeline-render-rows.ts");
  const { SESSION_END_NODE_KIND } = await import("../webapp/views/timeline-types.ts");
  const node = { kind: SESSION_END_NODE_KIND, when: "2026-01-01T00:00:00.000Z", sessionId: "abc12345", snapshots: [] };
  const context = {
    nodes: [node],
    reconstructionDocument: { gaps: [] },
    sessionColors: new Map([["abc12345", "#123456"]]),
    previewPanes: new Map(),
    nodeRows: new Map(),
    pickBoxes: new Map(),
    lineLabels: new Map(),
    laneRuns: [],
    selectTimelineRow: async () => {},
  };
  const container = document.createElement("div");
  await buildTimelineRows(context as never, container);
  assert.equal(container.querySelectorAll(".tl-row").length, 1);
  assert.equal(context.nodeRows.size, 1);
});
