// Task 290: hovering a leader line lights it and the visible nodes or bubbles it points at.

import { getRequiredElementById } from "./app-dom.ts";
import { listElementsDrawnAtAxisPx, readAxisPx } from "./layer1-ruler-click.ts";

// The class the CSS paints the aimed state from; not `.found`, which is the single persistent selection.
const AIMED_CLASS = "aimed";

// What the pointer is currently over, so leaving can darken exactly what entering lit.
let aimedElements: HTMLElement[] = [];

function clearAimedElements(): void {
  for (const element of aimedElements) {
    element.classList.remove(AIMED_CLASS);
  }
  aimedElements = [];
}

// True when an element overlaps the timeline pane's scrollport at all; rect-vs-rect, so correct under `zoom`.
function isInsideVisibleTimeline(element: HTMLElement): boolean {
  const pane = getRequiredElementById("timelines").getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return box.right > pane.left && box.left < pane.right
        && box.bottom > pane.top && box.top < pane.bottom;
}

// Light the line and its targets, or nothing: a line whose bubbles are all scrolled away stays grey.
function markLeaderAimedAtVisibleTargets(leader: HTMLElement): void {
  clearAimedElements();
  const visible: HTMLElement[] = [];
  for (const element of listElementsDrawnAtAxisPx(readAxisPx(leader))) {
    const isVisible = isInsideVisibleTimeline(element);
    if (isVisible) {
      visible.push(element);
    }
  }
  if (visible.length === 0) {
    return;
  }
  aimedElements = [leader, ...visible];
  for (const element of aimedElements) {
    element.classList.add(AIMED_CLASS);
  }
}

// Wire one positioned leader and return it; `pointerenter`/`pointerleave` do not refire along one line.
export function makeLeaderHoverable(leader: HTMLElement): HTMLElement {
  function markAimedOnEnter(): void {
    markLeaderAimedAtVisibleTargets(leader);
  }
  leader.addEventListener("pointerenter", markAimedOnEnter);
  leader.addEventListener("pointerleave", clearAimedElements);
  return leader;
}
