// Task 901: the sideways scroll strip pinned under the capped session column.

import { createElement, getRequiredElementById } from "../../app-dom.ts";

export const LANE_STRIP_ID = "sessionLaneStrip";
const NEEDED_CLASS = "is-needed";

// The strip sits inside the column, so the column is its parent.
export function applyLaneShift(): void {
  const strip = getRequiredElementById(LANE_STRIP_ID);
  strip.parentElement!.style.setProperty("--lane-shift", `${strip.scrollLeft}px`);
}

export function renderLaneStrip(): void {
  const strip = getRequiredElementById(LANE_STRIP_ID);
  const isNeeded = strip.scrollWidth > strip.clientWidth;
  strip.classList.toggle(NEEDED_CLASS, isNeeded);
  if (!isNeeded) {
    strip.scrollLeft = 0;
  }
  applyLaneShift();
}

// Sideways wheel moves the lanes only while the strip is needed; up-and-down wheel stays with the pane.
export function scrollLanesByWheel(event: WheelEvent): void {
  const strip = getRequiredElementById(LANE_STRIP_ID);
  const isNeeded = strip.classList.contains(NEEDED_CLASS);
  if (!isNeeded) {
    return;
  }
  const isSideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (!isSideways) {
    return;
  }
  strip.scrollLeft += event.deltaX;
  applyLaneShift();
  event.preventDefault();
}

export function buildLaneStrip(): HTMLElement {
  const strip = createElement("div", { id: LANE_STRIP_ID, class: "sessionLaneStrip", "data-component": "sessionLaneStrip" });
  strip.append(createElement("div", { class: "sessionLaneSpacer" }));
  strip.addEventListener("scroll", applyLaneShift);
  return strip;
}
