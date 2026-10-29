// The script-run drawer helpers build a two-file stage and open the drawer on one run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_RUN, SCRIPT_TOOL_USE_ID, buildScriptRunStage, openSingleRunDrawer } from "./layer1-drawer-script-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("buildScriptRunStage creates two nodes and one connector that share the tool use id", () => {
  initLayer1Dom();

  const { nodeA, nodeB, connector } = buildScriptRunStage();

  assert.equal(nodeA.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
  assert.equal(nodeB.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
  assert.equal(connector.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
});

test("openSingleRunDrawer returns the drawer body after the click", async () => {
  const body = await openSingleRunDrawer(SCRIPT_RUN);

  assert.equal(body.id, "dbody");
});
