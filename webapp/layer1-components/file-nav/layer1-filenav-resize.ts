// Task 279/288: `--filenav-w` writes ONCE on release, not per move, since move-per-write relaid out the ~156,000px canvas every frame.

// ponytail: rejected `resize: horizontal` on `.sourcesContainer` — it grabs just the corner, and no other rule can read its width.

import { getRequiredElementById } from "../../app-dom.ts";
import { FlexBox } from "../../flex-box.ts";

// The floor stops a drag collapsing the pane, which would take the grip with it and strand the user.
const MIN_FILENAV_WIDTH_PX = 120;
const MAX_FILENAV_WIDTH_PX = 640;

function normalizeFileNavWidth(widthPx: number): number {
  return Math.min(MAX_FILENAV_WIDTH_PX, Math.max(MIN_FILENAV_WIDTH_PX, widthPx));
}

// Measures the WRAPPER, not the pane, so the number is independent of the width the drag is changing.
function readFileNavWidthAtPointer(sessionDataContainer: HTMLElement, clientX: number): number {
  return normalizeFileNavWidth(clientX - sessionDataContainer.getBoundingClientRect().left);
}

// Preview-only: only the absolutely-positioned grip reads it, so a move repaints one element, not the whole canvas (task 288).
function setFileNavWidthPreview(sessionDataContainer: HTMLElement, clientX: number): void {
  sessionDataContainer.style.setProperty("--filenav-drag-w", `${readFileNavWidthAtPointer(sessionDataContainer, clientX)}px`);
}

// Must be measured before the first preview, or the timeline's box is already the thing changing.
function storeTimelineWidth(sessionDataContainer: HTMLElement): void {
  const timelineWidthPx = getRequiredElementById("timelineComponentsContainer").getBoundingClientRect().width;
  sessionDataContainer.style.setProperty("--timeline-w", `${timelineWidthPx}px`);
  sessionDataContainer.classList.add("resizing");
}

// The preview property must be removed or the grip stays pinned to the drag's last position forever.
function saveFileNavWidth(sessionDataContainer: HTMLElement, clientX: number): void {
  sessionDataContainer.style.setProperty("--filenav-w", `${readFileNavWidthAtPointer(sessionDataContainer, clientX)}px`);
  sessionDataContainer.style.removeProperty("--filenav-drag-w");
  sessionDataContainer.style.removeProperty("--timeline-w");
  sessionDataContainer.classList.remove("resizing");
}

// Move/release listen on the WINDOW since a fast drag outruns the 7px handle; happy-dom (the test runner) lacks `setPointerCapture`.
function attachWindowDragListeners(grip: HTMLElement, onMove: (event: MouseEvent) => void, onRelease: (event: MouseEvent) => void): void {
  const moveDragToPointer = (move: Event): void => onMove(move as MouseEvent);
  const stopDrag = (release: Event): void => {
    onRelease(release as MouseEvent);
    grip.classList.remove("dragging");
    window.removeEventListener("pointermove", moveDragToPointer);
    window.removeEventListener("pointerup", stopDrag);
  };
  window.addEventListener("pointermove", moveDragToPointer);
  window.addEventListener("pointerup", stopDrag);
}

export function attachGripDrag(
  grip: HTMLElement,
  onMove: (event: MouseEvent) => void,
  onRelease: (event: MouseEvent) => void,
  onStart: () => void = () => {},
): void {
  const launchDrag = (event: Event): void => {
    // Without this the browser starts a text selection and the drag paints the page blue.
    event.preventDefault();
    grip.classList.add("dragging");
    onStart();
    onMove(event as MouseEvent);
    attachWindowDragListeners(grip, onMove, onRelease);
  };
  grip.addEventListener("pointerdown", launchDrag);
}

export function initFileNavResize(): void {
  const sessionDataContainer = getRequiredElementById("sessionDataContainer");
  const moveWidthPreview = (event: MouseEvent): void => setFileNavWidthPreview(sessionDataContainer, event.clientX);
  const saveWidthAtPointer = (event: MouseEvent): void => saveFileNavWidth(sessionDataContainer, event.clientX);
  const storeWidthDragTimeline = (): void => storeTimelineWidth(sessionDataContainer);
  attachGripDrag(getRequiredElementById("filenav-grip"), moveWidthPreview, saveWidthAtPointer, storeWidthDragTimeline);
}

// Task 292: commits per MOVE, unlike the width drag, because no flex sibling means no big repaint.
// retired by step 21: the panes now share height by flex-grow.
// const MIN_PANE_SHARE = 15;
// const MAX_PANE_SHARE = 85;
//
// function setFileNavPaneShare(filenav: HTMLElement, clientY: number): void {
//   const box = filenav.getBoundingClientRect();
//   // happy-dom reports a zero-height box for every pane; guard so test drags write a share, not NaN.
//   const share = box.height === 0 ? MIN_PANE_SHARE : ((clientY - box.top) / box.height) * 100;
//   filenav.style.setProperty("--files-share", String(Math.min(MAX_PANE_SHARE, Math.max(MIN_PANE_SHARE, share))));
// }

const TOTAL_GROW = 5;
const MIN_PANE_HEIGHT_PX = 80;

function setSourcesPaneGrows(sourcesBox: FlexBox, fileNavComponent: HTMLElement, jsonlsComponent: HTMLElement, clientY: number): void {
  const box = sourcesBox.element.getBoundingClientRect();
  // happy-dom reports a zero-height box; skip so a drag writes no NaN.
  if (box.height === 0) {
    return;
  }
  const minShare = MIN_PANE_HEIGHT_PX / box.height;
  const rawShare = (clientY - box.top) / box.height;
  const topShare = Math.min(1 - minShare, Math.max(minShare, rawShare));
  sourcesBox.setGrow(fileNavComponent, topShare * TOTAL_GROW);
  sourcesBox.setGrow(jsonlsComponent, (1 - topShare) * TOTAL_GROW);
}

export function initSessionPaneResize(): void {
  const sourcesBox = new FlexBox(FlexBox.layoutModes.rows, getRequiredElementById("sourcesContainer"));
  const fileNavComponent = getRequiredElementById("fileNavComponent");
  const jsonlsComponent = getRequiredElementById("jsonlsComponent");
  const updatePaneGrows = (event: MouseEvent): void => setSourcesPaneGrows(sourcesBox, fileNavComponent, jsonlsComponent, event.clientY);
  attachGripDrag(getRequiredElementById("navpane-grip"), updatePaneGrows, updatePaneGrows);
  // const filenav = document.querySelector(".sourcesContainer") as HTMLElement | null;
  // const grip = document.getElementById("navpane-grip");
  // const isPaneMissing = filenav === null || grip === null;
  // if (isPaneMissing) {
  //   return;
  // }
  // const updatePaneShare = (event: MouseEvent): void => setFileNavPaneShare(filenav, event.clientY);
  // attachGripDrag(grip, updatePaneShare, updatePaneShare);
}
