// The shared render context starts empty and its details context shares the same nodes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_createTimelineRenderContext_starts_with_empty_selection_state", async () => {
  initWebappDom();
  const { createTimelineRenderContext } = await import("../webapp/views/timeline-context.ts");
  const element = {} as HTMLElement;
  const nodes: never[] = [];
  const context = createTimelineRenderContext({
    project: "p",
    nodes,
    listing: undefined,
    reconstructionDocument: {} as never,
    sessionColors: new Map<string, string>(),
    selectbar: element,
    barText: element,
    ruleHint: element,
  });
  assert.equal(context.project, "p");
  assert.equal(context.selectedRow, null);
  assert.equal(context.fileNavReferenceIndex, -1);
  assert.deepEqual(context.pickedIndexes, []);
  assert.equal(context.detailsContext.nodes, nodes);
  assert.equal(context.detailsContext.project, "p");
});
