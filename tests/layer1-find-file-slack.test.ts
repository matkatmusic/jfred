// A node near a scroll end still lands centred, because the pane gains slack on that side first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { scrollToUncoveredCentre } = await import("../webapp/layer1-find-file.ts");

const PANE_WIDTH_PX = 500;
const PANE_HEIGHT_PX = 800;
const CONTENT_WIDTH_PX = 5000;
const CONTENT_HEIGHT_PX = 9000;
const NODE_SIZE_PX = 15;

function readSlackPx(pane: HTMLElement, side: string): number {
  return parseFloat(pane.style.getPropertyValue(`--slack-${side}`)) || 0;
}

function clampScroll(pane: HTMLElement, wanted: number, contentPx: number, viewPx: number, startSide: string, endSide: string): number {
  const maxScroll = contentPx + readSlackPx(pane, startSide) + readSlackPx(pane, endSide) - viewPx;
  return Math.min(Math.max(wanted, 0), maxScroll);
}

// A pane that clamps scroll like a browser and shifts content by its start-side slack.
function buildClampingPane(): HTMLElement {
  const pane = getRequiredElementById("timelines");
  let scrollLeft = 0;
  let scrollTop = 0;
  Object.defineProperty(pane, "scrollLeft", {
    get: () => scrollLeft,
    set: (wanted: number) => { scrollLeft = clampScroll(pane, wanted, CONTENT_WIDTH_PX, PANE_WIDTH_PX, "left", "right"); },
  });
  Object.defineProperty(pane, "scrollTop", {
    get: () => scrollTop,
    set: (wanted: number) => { scrollTop = clampScroll(pane, wanted, CONTENT_HEIGHT_PX, PANE_HEIGHT_PX, "top", "bottom"); },
  });
  Object.defineProperty(pane, "scrollWidth", { get: () => CONTENT_WIDTH_PX + readSlackPx(pane, "left") + readSlackPx(pane, "right") });
  Object.defineProperty(pane, "scrollHeight", { get: () => CONTENT_HEIGHT_PX + readSlackPx(pane, "top") + readSlackPx(pane, "bottom") });
  Object.defineProperty(pane, "clientWidth", { get: () => PANE_WIDTH_PX });
  Object.defineProperty(pane, "clientHeight", { get: () => PANE_HEIGHT_PX });
  pane.getBoundingClientRect = () => ({ left: 0, right: PANE_WIDTH_PX, top: 0, bottom: PANE_HEIGHT_PX, width: PANE_WIDTH_PX, height: PANE_HEIGHT_PX }) as DOMRect;
  getRequiredElementById("drawer").getBoundingClientRect = () => ({ left: PANE_WIDTH_PX, right: PANE_WIDTH_PX, top: 0, bottom: PANE_HEIGHT_PX, width: 0, height: PANE_HEIGHT_PX }) as DOMRect;
  return pane;
}

function placeNodeAtContentPoint(pane: HTMLElement, contentX: number, contentY: number): HTMLElement {
  const node = document.createElement("i");
  node.getBoundingClientRect = () => {
    const left = contentX + readSlackPx(pane, "left") - pane.scrollLeft;
    const top = contentY + readSlackPx(pane, "top") - pane.scrollTop;
    return { left, right: left + NODE_SIZE_PX, top, bottom: top + NODE_SIZE_PX, width: NODE_SIZE_PX, height: NODE_SIZE_PX } as DOMRect;
  };
  return node;
}

function readCentreOffsets(node: HTMLElement): { x: number; y: number } {
  const box = node.getBoundingClientRect();
  return { x: (box.left + box.right) / 2 - PANE_WIDTH_PX / 2, y: (box.top + box.bottom) / 2 - PANE_HEIGHT_PX / 2 };
}

test("test_a_node_at_the_top_left_corner_still_lands_at_the_centre", () => {
  initLayer1Dom();
  const pane = buildClampingPane();
  const node = placeNodeAtContentPoint(pane, 100, 100);
  scrollToUncoveredCentre(node);
  assert.ok(Math.abs(readCentreOffsets(node).x) <= 1);
  assert.ok(Math.abs(readCentreOffsets(node).y) <= 1);
});

test("test_a_node_at_the_bottom_right_corner_still_lands_at_the_centre", () => {
  initLayer1Dom();
  const pane = buildClampingPane();
  const node = placeNodeAtContentPoint(pane, CONTENT_WIDTH_PX - 50, CONTENT_HEIGHT_PX - 50);
  scrollToUncoveredCentre(node);
  assert.ok(Math.abs(readCentreOffsets(node).x) <= 1);
  assert.ok(Math.abs(readCentreOffsets(node).y) <= 1);
});

test("test_a_node_in_the_middle_adds_no_slack", () => {
  initLayer1Dom();
  const pane = buildClampingPane();
  const node = placeNodeAtContentPoint(pane, 2500, 4500);
  scrollToUncoveredCentre(node);
  assert.ok(Math.abs(readCentreOffsets(node).y) <= 1);
  for (const side of ["left", "right", "top", "bottom"]) {
    assert.equal(readSlackPx(pane, side), 0);
  }
});
