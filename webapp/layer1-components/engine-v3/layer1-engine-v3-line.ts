// engineV3 mockup line: one dashed line across the timeline at the current step's time. No label.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { computeAxisPixelsAt } from "../bubbles/layer1-ranges.ts";
import { setAxisPx } from "../bubbles/layer1-lane-nodes.ts";
import { readCurrentStep } from "./layer1-engine-v3-state.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

const LINE_ID = "engine-v3-line";

// Module state because a filter redraw hands the stage a view, and the marker moves between redraws.
let ticks: readonly WireRulerTick[] = [];

// In the canvas, so the line spans every column and follows zoom.
function getEngineV3Line(): HTMLElement {
  const existingLine = document.getElementById(LINE_ID);
  if (existingLine !== null) {
    return existingLine;
  }
  const line = createElement("div", { id: LINE_ID, class: "engine-v3-line" });
  document.querySelector(".canvas")!.append(line);
  return line;
}

export function renderEngineV3Line(): void {
  const line = getEngineV3Line();
  const step = readCurrentStep();
  line.hidden = step === undefined || ticks.length === 0;
  if (line.hidden) {
    return;
  }
  setAxisPx(line, computeAxisPixelsAt(Date.parse(step!.nodeTime), ticks));
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
  const paneBox = getRequiredElementById("timelines").getBoundingClientRect();
  const lineBox = line.getBoundingClientRect();
  const isInView = lineBox.top >= paneBox.top && lineBox.bottom <= paneBox.bottom;
  if (isInView) {
    return;
  }
  line.scrollIntoView({ block: "center" });
}
