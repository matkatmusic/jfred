// Task 279/288: drag the File Nav pane's right edge to resize it. `--filenav-w` is written ONCE,
// on release, because `.filenav` is a flex sibling of `main.timelines` — writing it per move
// relaid out the ~156,000px canvas every frame. Per move the drag writes `--filenav-drag-w`, read
// only by the absolutely-positioned grip, and `.stagewrap.resizing` pins the timeline's width so
// the growing nav translates it instead of re-solving the flex row.
//
// ponytail: rejected `resize: horizontal` on `.filenav`, which is zero JS — it grabs only at the
// bottom-right corner rather than along the edge the user asked for, and it writes the element's
// own width, which no other rule can read.

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

// Preview-only property: only the absolutely-positioned grip reads it, so a move repaints one
// element instead of relaying out the canvas (task 288).
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

// Move/release listen on the WINDOW because a fast drag outruns a 7px handle, and
// `setPointerCapture` is not implemented by happy-dom, which the tests run on.
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

// Task 292: committed per MOVE, unlike the width drag — the canvas is not a flex sibling here, so
// there is no big repaint to defer.
const MIN_PANE_SHARE = 15;
const MAX_PANE_SHARE = 85;

function resizeFileNavPanes(filenav: HTMLElement, clientY: number): void {
    const box = filenav.getBoundingClientRect();
    // A zero-height pane cannot happen in a browser, but happy-dom reports 0 for every box — guard
    // so a test drag writes a share rather than NaN.
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
