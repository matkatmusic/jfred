// The timeline orchestrator loads and exposes no details context before the first render.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_timeline_module_has_no_active_details_context_before_render", async () => {
  initWebappDom();
  const timeline = await import("../webapp/views/timeline.ts");
  assert.equal(timeline.activeDetailsContext, undefined);
  assert.equal(typeof timeline.renderTimelineView, "function");
});
