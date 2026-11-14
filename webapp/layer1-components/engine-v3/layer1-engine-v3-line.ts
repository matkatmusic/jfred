// engineV3 mockup line: one dashed line across the timeline at the current step's time. No label.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { computeAxisPixelsAt } from "../bubbles/layer1-ranges.ts";
import { setAxisPx } from "../bubbles/layer1-lane-nodes.ts";
import { listElementsDrawnAtAxisPx } from "../ruler/layer1-ruler-click.ts";
import { CURRENT_NODE_CLASS, readCurrentStep } from "./layer1-engine-v3-state.ts";
import { EngineV3StepKind } from "./layer1-wire-engine-v3.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

const LINE_ID = "engine-v3-line";

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

// In the canvas, so the line spans every column and follows zoom.
function getEngineV3Line(): HTMLElement {
  const existingLine = document.getElementById(LINE_ID);
  if (existingLine !== null) {
    return existingLine;
  }
  const line = createElement("div", { id: LINE_ID, class: "engine-v3-line", "data-component": "engineV3CurrentStepTick" });
  document.querySelector(".canvas")!.append(line);
  return line;
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
