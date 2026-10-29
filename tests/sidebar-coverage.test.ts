// Coverage strip: one cell per revision, a recovered count, and a reason popover on red cells.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { appendCoverageStrip } from "../webapp/views/sidebar-coverage.ts";

function buildStripItem(): HTMLElement {
  initWebappDom();
  const item = document.createElement("div");
  document.body.append(item);
  appendCoverageStrip(item, "a.ts", [
    { recovered: true, revisionIndex: 0 },
    { recovered: false, reason: "no backup", revisionIndex: 1 },
  ]);
  return item;
}

test("the strip has one cell per revision and a recovered count", () => {
  const item = buildStripItem();
  assert.equal(item.querySelectorAll(".covbar > span").length, 2);
  assert.equal(item.querySelector(".revcount")!.textContent, "1 / 2 revs");
});

test("clicking a red cell opens a popover with the reason, and again closes it", () => {
  const item = buildStripItem();
  const redCell = item.querySelector(".miss") as HTMLElement;
  redCell.click();
  assert.match(document.querySelector(".cov-popover")!.textContent!, /reason: no backup/);
  redCell.click();
  assert.equal(document.querySelector(".cov-popover"), null);
});
