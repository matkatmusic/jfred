// Timeline row jump/flash and the Expand All toggle, driven through a fresh happy-dom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { TimelineRenderContext } from "../webapp/views/timeline-render-context.ts";

async function loadSelectionModule() {
  initWebappDom();
  return import("../webapp/views/timeline-render-selection.ts");
}

test("test_toggle_all_button_expands_every_row_then_offers_collapse", async () => {
  const { attachToggleAllButton } = await loadSelectionModule();
  document.getElementById("toggle-all")?.remove();
  const button = document.createElement("button");
  button.id = "toggle-all";
  document.body.appendChild(button);
  const expandedRow = document.createElement("div");
  expandedRow.classList.add("expanded");
  const collapsedRow = document.createElement("div");
  const context = { expandableRows: [expandedRow, collapsedRow] } as unknown as TimelineRenderContext;
  attachToggleAllButton(context);
  assert.equal(button.textContent, "Expand All");
  button.click();
  assert.equal(collapsedRow.classList.contains("expanded"), true);
  assert.equal(button.textContent, "Collapse All");
});

test("test_moveToTimelineRow_scrolls_and_flashes_the_row", async () => {
  const { moveToTimelineRow } = await loadSelectionModule();
  const row = document.createElement("div");
  const scrollCalls: unknown[] = [];
  row.scrollIntoView = (options?: unknown) => scrollCalls.push(options);
  const context = { nodeRows: new Map([[3, row]]) } as unknown as TimelineRenderContext;
  moveToTimelineRow(context, 3);
  assert.deepEqual(scrollCalls, [{ block: "start" }]);
  assert.equal(row.classList.contains("flash"), true);
});
