// Task 279/288: `--filenav-w` writes ONCE on release, not per move, since move-per-write relaid out the ~156,000px canvas every frame.

// ponytail: rejected `resize: horizontal` on `.filenav` — it grabs just the corner, and no other rule can read its width.

import { getRequiredElementById } from "./app-dom.ts";

// The floor stops a drag collapsing the pane, which would take the grip with it and strand the user.
const MIN_FILENAV_WIDTH_PX = 120;
const MAX_FILENAV_WIDTH_PX = 640;

function clampFileNavWidth(widthPx: number): number {
    return Math.min(MAX_FILENAV_WIDTH_PX, Math.max(MIN_FILENAV_WIDTH_PX, widthPx));
}

// Measures the WRAPPER, not the pane, so the number is independent of the width the drag is changing.
function readFileNavWidthAtPointer(stagewrap: HTMLElement, clientX: number): number {
    return clampFileNavWidth(clientX - stagewrap.getBoundingClientRect().left);
}

// Preview-only: only the absolutely-positioned grip reads it, so a move repaints one element, not the whole canvas (task 288).
function previewFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-drag-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
}

// Must be measured before the first preview, or the timeline's box is already the thing changing.
function freezeTimelineWidth(stagewrap: HTMLElement): void {
    const timelineWidthPx = getRequiredElementById("timelines").getBoundingClientRect().width;
    stagewrap.style.setProperty("--timeline-w", `${timelineWidthPx}px`);
    stagewrap.classList.add("resizing");
}

// The preview property must be removed or the grip stays pinned to the drag's last position forever.
function commitFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
    stagewrap.style.removeProperty("--filenav-drag-w");
    stagewrap.style.removeProperty("--timeline-w");
    stagewrap.classList.remove("resizing");
}

// Move/release listen on the WINDOW since a fast drag outruns the 7px handle; happy-dom (the test runner) lacks `setPointerCapture`.
function wireGripDrag(
    grip: HTMLElement,
    onMove: (event: MouseEvent) => void,
    onRelease: (event: MouseEvent) => void,
    onStart: () => void = () => {},
): void {
    grip.addEventListener("pointerdown", (event) => {
        // Without this the browser starts a text selection and the drag paints the page blue.
        event.preventDefault();
        grip.classList.add("dragging");
        onStart();
        onMove(event as MouseEvent);
        const dragToPointer = (move: Event): void => onMove(move as MouseEvent);
        const endDrag = (release: Event): void => {
            onRelease(release as MouseEvent);
            grip.classList.remove("dragging");
            window.removeEventListener("pointermove", dragToPointer);
            window.removeEventListener("pointerup", endDrag);
        };
        window.addEventListener("pointermove", dragToPointer);
        window.addEventListener("pointerup", endDrag);
    });
}

export function wireFileNavResize(): void {
    const stagewrap = getRequiredElementById("stagewrap");
    wireGripDrag(
        getRequiredElementById("filenav-grip"),
        (event) => previewFileNavWidth(stagewrap, event.clientX),
        (event) => commitFileNavWidth(stagewrap, event.clientX),
        () => freezeTimelineWidth(stagewrap),
    );
}

// Task 292: committed per MOVE, unlike the width drag — no flex sibling here means no big repaint to defer.
const MIN_PANE_SHARE = 15;
const MAX_PANE_SHARE = 85;

function resizeFileNavPanes(filenav: HTMLElement, clientY: number): void {
    const box = filenav.getBoundingClientRect();
    // happy-dom reports a zero-height box for every pane; guard so test drags write a share, not NaN.
    const share = box.height === 0 ? MIN_PANE_SHARE : ((clientY - box.top) / box.height) * 100;
    filenav.style.setProperty("--files-share", String(Math.min(MAX_PANE_SHARE, Math.max(MIN_PANE_SHARE, share))));
}

export function wireSessionPaneResize(): void {
    const filenav = document.querySelector(".filenav") as HTMLElement | null;
    const grip = document.getElementById("navpane-grip");
    if (filenav === null || grip === null) {
        return;
    }
    const resize = (event: MouseEvent): void => resizeFileNavPanes(filenav, event.clientY);
    wireGripDrag(grip, resize, resize);
}
