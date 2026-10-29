// Task 279/288: `--filenav-w` writes ONCE on release, not per move, since move-per-write relaid out the ~156,000px canvas every frame.

// ponytail: rejected `resize: horizontal` on `.filenav` — it grabs just the corner, and no other rule can read its width.

import { getRequiredElementById } from "./app-dom.ts";

// The floor stops a drag collapsing the pane, which would take the grip with it and strand the user.
const MIN_FILENAV_WIDTH_PX = 120;
const MAX_FILENAV_WIDTH_PX = 640;

function normalizeFileNavWidth(widthPx: number): number {
  return Math.min(MAX_FILENAV_WIDTH_PX, Math.max(MIN_FILENAV_WIDTH_PX, widthPx));
}

// Measures the WRAPPER, not the pane, so the number is independent of the width the drag is changing.
function readFileNavWidthAtPointer(stagewrap: HTMLElement, clientX: number): number {
  return normalizeFileNavWidth(clientX - stagewrap.getBoundingClientRect().left);
}

// Preview-only: only the absolutely-positioned grip reads it, so a move repaints one element, not the whole canvas (task 288).
function setFileNavWidthPreview(stagewrap: HTMLElement, clientX: number): void {
  stagewrap.style.setProperty("--filenav-drag-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
}

// Must be measured before the first preview, or the timeline's box is already the thing changing.
function storeTimelineWidth(stagewrap: HTMLElement): void {
  const timelineWidthPx = getRequiredElementById("timelines").getBoundingClientRect().width;
  stagewrap.style.setProperty("--timeline-w", `${timelineWidthPx}px`);
  stagewrap.classList.add("resizing");
}

// The preview property must be removed or the grip stays pinned to the drag's last position forever.
function saveFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
  stagewrap.style.setProperty("--filenav-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
  stagewrap.style.removeProperty("--filenav-drag-w");
  stagewrap.style.removeProperty("--timeline-w");
  stagewrap.classList.remove("resizing");
}

// Move/release listen on the WINDOW since a fast drag outruns the 7px handle; happy-dom (the test runner) lacks `setPointerCapture`.
function attachGripDrag(
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
    const moveDragToPointer = (move: Event): void => onMove(move as MouseEvent);
    const stopDrag = (release: Event): void => {
      onRelease(release as MouseEvent);
      grip.classList.remove("dragging");
      window.removeEventListener("pointermove", moveDragToPointer);
      window.removeEventListener("pointerup", stopDrag);
    };
    window.addEventListener("pointermove", moveDragToPointer);
    window.addEventListener("pointerup", stopDrag);
  };
  grip.addEventListener("pointerdown", launchDrag);
}

export function initFileNavResize(): void {
  const stagewrap = getRequiredElementById("stagewrap");
  const moveWidthPreview = (event: MouseEvent): void => setFileNavWidthPreview(stagewrap, event.clientX);
  const saveWidthAtPointer = (event: MouseEvent): void => saveFileNavWidth(stagewrap, event.clientX);
  const storeWidthDragTimeline = (): void => storeTimelineWidth(stagewrap);
  attachGripDrag(getRequiredElementById("filenav-grip"), moveWidthPreview, saveWidthAtPointer, storeWidthDragTimeline);
}

// Task 292: commits per MOVE, unlike the width drag, because no flex sibling means no big repaint.
const MIN_PANE_SHARE = 15;
const MAX_PANE_SHARE = 85;

function setFileNavPaneShare(filenav: HTMLElement, clientY: number): void {
  const box = filenav.getBoundingClientRect();
  // happy-dom reports a zero-height box for every pane; guard so test drags write a share, not NaN.
  const share = box.height === 0 ? MIN_PANE_SHARE : ((clientY - box.top) / box.height) * 100;
  filenav.style.setProperty("--files-share", String(Math.min(MAX_PANE_SHARE, Math.max(MIN_PANE_SHARE, share))));
}

export function initSessionPaneResize(): void {
  const filenav = document.querySelector(".filenav") as HTMLElement | null;
  const grip = document.getElementById("navpane-grip");
  const isPaneMissing = filenav === null || grip === null;
  if (isPaneMissing) {
    return;
  }
  const updatePaneShare = (event: MouseEvent): void => setFileNavPaneShare(filenav, event.clientY);
  attachGripDrag(grip, updatePaneShare, updatePaneShare);
}
