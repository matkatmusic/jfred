// TimelineRenderContext is a type-only module: it must load, and its selection-state fields must type-check.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TimelineRenderContext } from "../webapp/views/timeline-render-context.ts";

test("test_render_context_module_loads_and_selection_fields_type_check", async () => {
  await import("../webapp/views/timeline-render-context.ts");
  const selectionState: Pick<TimelineRenderContext, "selectedRow" | "fileNavReferenceIndex" | "pickedIndexes"> = {
    selectedRow: null,
    fileNavReferenceIndex: 4,
    pickedIndexes: [],
  };
  assert.equal(selectionState.fileNavReferenceIndex, 4);
  assert.equal(selectionState.selectedRow, null);
});
