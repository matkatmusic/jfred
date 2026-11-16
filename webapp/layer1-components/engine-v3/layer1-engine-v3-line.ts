// engineV3 mockup line: one dashed line across the timeline at the current step's time. No label.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { computeAxisPixelsAt } from "../bubbles/layer1-ranges.ts";
import { setAxisPx } from "../bubbles/layer1-lane-nodes.ts";
import { listElementsDrawnAtAxisPx } from "../ruler/layer1-ruler-click.ts";
import { CURRENT_NODE_CLASS, readCurrentStep } from "./layer1-engine-v3-state.ts";
import { EngineV3StepKind } from "./layer1-wire-engine-v3.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";
import { getCurrentZoom } from "../top-bars/layer1-zoom.ts";
import { computeUncoveredArea, moveToUncoveredCentre } from "../top-bars/layer1-find-file.ts";

const LINE_ID = "engine-v3-line";
const LEFT_EDGE_VARIABLE = "--engine-line-left";

// CSS draws a bubble with this class solid above the line, so the line hides inside it.
const LINE_HIDING_BUBBLE_CLASS = "hides-engine-v3-line";

// Commit nodes are ringed by hash in the panel; any other step rings the bubble nodes on its line.
function ringStepNodesOnLine(elements: readonly HTMLElement[]): void {
  const isCommitStep = readCurrentStep()!.kind === EngineV3StepKind.commit;
  if (isCommitStep) {
    return;
  }
  for (const element of elements) {
    if (element.matches(".node")) {
      if (!element.matches(".n-commit")) {
        element.classList.add(CURRENT_NODE_CLASS);
      }
    }
  }
}

function markBubblesHoldingNodesOnLine(axisPx: number | undefined): void {
  for (const bubble of document.querySelectorAll<HTMLElement>(".filebox")) {
    bubble.classList.remove(LINE_HIDING_BUBBLE_CLASS);
  }
  if (axisPx === undefined) {
    return;
  }
  const elementsOnLine = listElementsDrawnAtAxisPx(axisPx);
  // for (const element of listElementsDrawnAtAxisPx(axisPx)) {
  for (const element of elementsOnLine) {
    element.closest<HTMLElement>(".filebox")!.classList.add(LINE_HIDING_BUBBLE_CLASS);
  }
  ringStepNodesOnLine(elementsOnLine);
}

// Module state because a filter redraw hands the stage a view, and the marker moves between redraws.
let ticks: readonly WireRulerTick[] = [];

// // In the canvas, so the line spans every column and follows zoom.
// In the canvas, so the line follows zoom and scroll; its left edge is set by placeEngineV3LineLeftEdge.
function getEngineV3Line(): HTMLElement {
  const existingLine = document.getElementById(LINE_ID);
  if (existingLine !== null) {
    return existingLine;
  }
  const line = createElement("div", { id: LINE_ID, class: "engine-v3-line", "data-component": "engineV3CurrentStepTick" });
  document.querySelector(".canvas")!.append(line);
  new window.ResizeObserver(placeEngineV3LineLeftEdge).observe(getRequiredElementById("timelineRulerContainer"));
  getRequiredElementById("timelineContainer").addEventListener("scroll", placeEngineV3LineLeftEdge);
  return line;
}

// Viewport edges to a canvas coordinate: the scroll offset is inside the canvas left edge, and zoom scales every rectangle.
export function computeEngineV3LineLeftEdgePx(rulerContainerRightPx: number, commitColumnRightPx: number | undefined, canvasLeftPx: number, zoom: number): number {
  let columnsRightPx = rulerContainerRightPx;
  if (commitColumnRightPx !== undefined) {
    columnsRightPx = Math.max(rulerContainerRightPx, commitColumnRightPx);
  }
  return (columnsRightPx - canvasLeftPx) / zoom;
}

// A page with no line yet has nothing to place; it must not make the line.
export function placeEngineV3LineLeftEdge(): void {
  const line = document.getElementById(LINE_ID);
  if (line === null) {
    return;
  }
  const rulerContainerRightPx = getRequiredElementById("timelineRulerContainer").getBoundingClientRect().right;
  const commitColumn = document.getElementById("jfredCommitsDrawerComponent");
  let commitColumnRightPx: number | undefined;
  if (commitColumn !== null) {
    commitColumnRightPx = commitColumn.getBoundingClientRect().right;
  }
  const canvasLeftPx = line.parentElement!.getBoundingClientRect().left;
  const leftEdgePx = computeEngineV3LineLeftEdgePx(rulerContainerRightPx, commitColumnRightPx, canvasLeftPx, getCurrentZoom());
  line.style.setProperty(LEFT_EDGE_VARIABLE, `${leftEdgePx}px`);
}

export function renderEngineV3Line(): void {
  const line = getEngineV3Line();
  const step = readCurrentStep();
  line.hidden = step === undefined || ticks.length === 0;
  if (line.hidden) {
    markBubblesHoldingNodesOnLine(undefined);
    return;
  }
  // setAxisPx(line, computeAxisPixelsAt(Date.parse(step!.nodeTime), ticks));
  const axisPx = computeAxisPixelsAt(Date.parse(step!.nodeTime), ticks);
  setAxisPx(line, axisPx);
  markBubblesHoldingNodesOnLine(axisPx);
  placeEngineV3LineLeftEdge();
}

// Called by every stage render with its ruler, so a redraw keeps the line on the same time.
export function renderEngineV3LineAtTicks(nextTicks: readonly WireRulerTick[]): void {
  ticks = nextTicks;
  renderEngineV3Line();
}

export function moveEngineV3LineIntoView(): void {
  const line = getEngineV3Line();
  if (line.hidden) {
    return;
  }
  const paneBox = getRequiredElementById("timelineContainer").getBoundingClientRect();
  const lineBox = line.getBoundingClientRect();
  const isInView = lineBox.top >= paneBox.top && lineBox.bottom <= paneBox.bottom;
  if (isInView) {
    return;
  }
  line.scrollIntoView({ block: "center" });
}

export function moveEngineV3CommitNodeIntoView(): void {
  const commitNode = document.querySelector<HTMLElement>(`i.node.n-commit.${CURRENT_NODE_CLASS}`);
  if (commitNode === null) {
    moveEngineV3LineIntoView();
    return;
  }
  const paneBox = getRequiredElementById("timelineContainer").getBoundingClientRect();
  const area = computeUncoveredArea(paneBox, getRequiredElementById("detailsPaneContainer").getBoundingClientRect());
  let visibleLeft = Math.max(area.left, getRequiredElementById("timelineRulerContainer").getBoundingClientRect().right);
  const commitColumn = document.getElementById("jfredCommitsDrawerComponent");
  if (commitColumn !== null) {
    visibleLeft = Math.max(visibleLeft, commitColumn.getBoundingClientRect().right);
  }
  const nodeBox = commitNode.getBoundingClientRect();
  const isInView = nodeBox.left >= visibleLeft && nodeBox.right <= area.right && nodeBox.top >= area.top && nodeBox.bottom <= area.bottom;
  if (isInView) {
    return;
  }
  moveToUncoveredCentre(commitNode);
}
