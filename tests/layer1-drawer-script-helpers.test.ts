// The script-run drawer helpers build a two-file stage and open the drawer on one run.

// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { SCRIPT_RUN, SCRIPT_TOOL_USE_ID, buildScriptRunStage, openSingleRunDrawer } from "./layer1-drawer-script-helpers.ts";
// import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// not behavior: this checks a test helper's own output (attributes it sets on a stage it builds), not product behavior.
// test("buildScriptRunStage creates two nodes and one connector that share the tool use id", () => {
//   initLayer1Dom();
//
//   const { nodeA, nodeB, connector } = buildScriptRunStage();
//
//   assert.equal(nodeA.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
//   assert.equal(nodeB.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
//   assert.equal(connector.getAttribute("data-tool-use-id"), SCRIPT_TOOL_USE_ID);
// });

// not behavior: this checks that a test helper returns the element with id "dbody", not product behavior.
// test("openSingleRunDrawer returns the drawer body after the click", async () => {
//   const body = await openSingleRunDrawer(SCRIPT_RUN);
//
//   assert.equal(body.id, "dbody");
// });
