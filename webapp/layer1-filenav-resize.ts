// Task 279: drag the File Nav pane's right edge to resize it.
//
// The drag commits ONE custom property, `--filenav-w`, onto `.stagewrap`. webapp/layer1-styles.css
// gives BOTH `.filenav`'s width and `.minimap`'s `left` that property, so the minimap tracks the
// pane instead of drifting over it — and the duplicated `232px` literal those two rules used to
// share is gone.
//
// Task 288: that property is written ONCE, on release. Per move the drag writes `--filenav-drag-w`
// instead, which nothing but `.filenav-grip`'s `left` reads. Writing `--filenav-w` per move resized
// `.filenav`, a flex SIBLING of `main.timelines` — so every frame of the drag relaid out the flex
// row and repainted the ~156,000px canvas of ~800 widgets and 683 full-canvas dashed leader lines
// inside it. The grip is `position: absolute` against `.stagewrap` and outside that row, so moving
// it reflows nothing.
//
// Task 288 follow-up: the pane follows the drag again — but only because `.stagewrap.resizing`
// pins `main.timelines` to the width it already had. A frozen-width timeline is out of the flex
// solve, so the growing nav TRANSLATES it rather than relaying out its canvas; that is what keeps
// the per-frame cost at a paint. `--timeline-w` is read once, on pointerdown, for the same reason
// `--filenav-w` is written once, on release.
//
// ponytail: rejected `resize: horizontal` on `.filenav`, which is zero JS — it grabs only at the
// bottom-right corner rather than along the edge the user asked for, and it writes the element's
// own width, which no other rule can read.

import { getRequiredElementById } from "./app-dom.ts";

// Floor and ceiling for the pane. The floor is what stops a drag past the left edge collapsing the
// pane to nothing — the grip would go with it, leaving no way back without a reload. The ceiling
// keeps the timeline, which is the page, from being squeezed off screen.
const MIN_FILENAV_WIDTH_PX = 120;
const MAX_FILENAV_WIDTH_PX = 640;

function clampFileNavWidth(widthPx: number): number {
    return Math.min(MAX_FILENAV_WIDTH_PX, Math.max(MIN_FILENAV_WIDTH_PX, widthPx));
}

// The pane width a pointer at `clientX` asks for: the distance from the wrapper's left edge, since
// `.filenav` is the wrapper's first flex child and starts there. Reading the WRAPPER, not the pane,
// is what keeps the number independent of the width this drag is changing.
function readFileNavWidthAtPointer(stagewrap: HTMLElement, clientX: number): number {
    return clampFileNavWidth(clientX - stagewrap.getBoundingClientRect().left);
}

// While the button is down, publish the width as a PREVIEW only. `--filenav-drag-w` is read by
// nothing but `.filenav-grip`'s `left`, and the grip is `position: absolute` against .stagewrap and
// outside the flex row — so a move repaints one 6px element instead of relaying out `.filenav`, its
// flex sibling `main.timelines`, and the ~156,000px canvas of ~800 widgets inside it (task 288).
function previewFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-drag-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
}

// Pin `main.timelines` to the width it has RIGHT NOW, so the flex row cannot re-solve it while the
// nav grows. The number is measured before the first preview is published — once the nav starts
// following the pointer, the timeline's own box would already be the thing being changed.
function freezeTimelineWidth(stagewrap: HTMLElement): void {
    const timelineWidthPx = getRequiredElementById("timelines").getBoundingClientRect().width;
    stagewrap.style.setProperty("--timeline-w", `${timelineWidthPx}px`);
    stagewrap.classList.add("resizing");
}

// On release, write the width the pane, the minimap and the grip all read — once per drag. Removing
// the preview property is what hands `.filenav-grip` back to its `var(--filenav-drag-w, ...)`
// fallback; leaving it set would pin the grip to the drag's last position forever. Dropping
// `resizing` and `--timeline-w` in the same statement is what lets the timeline flex again and
// absorb the width the nav just took — one relayout per drag, at the end.
function commitFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
    stagewrap.style.removeProperty("--filenav-drag-w");
    stagewrap.style.removeProperty("--timeline-w");
    stagewrap.classList.remove("resizing");
}

// The drag plumbing both grips share. Move and release are listened for on the WINDOW, not on the
// grip: a 7 px handle is narrower than a fast drag's per-frame travel, so a grip-bound listener
// would drop the drag the moment the pointer outran it. `setPointerCapture` would do the same job
// in a browser but is not implemented by happy-dom, which is what the tests run on.
//
// `onRelease` is separate from `onMove` because the width drag commits a DIFFERENT property than the
// one it previews (task 288); the pane split has nothing to defer, so it passes the same callback
// twice.
function wireGripDrag(
    grip: HTMLElement,
    onMove: (event: MouseEvent) => void,
    onRelease: (event: MouseEvent) => void,
    onStart: () => void = () => {},
): void {
    grip.addEventListener("pointerdown", (event) => {
        // Without this the browser starts a text selection instead, and the drag paints the whole
        // page blue.
        event.preventDefault();
        grip.classList.add("dragging");
        // Before the first preview: what it measures must not already be the thing being changed.
        onStart();
        onMove(event as MouseEvent);
        const dragToPointer = (move: Event): void => onMove(move as MouseEvent);
        // The release event's own coordinates are the pointer's final position, so no last-move
        // variable has to be carried across the drag.
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

// Task 292: the horizontal split between the File Nav and the JSONLs pane, as a share out of 100.
// Committed per MOVE, unlike the width drag: re-sharing the aside's height reflows the two lists
// and nothing else — the canvas is not a flex sibling of either, so there is no ~156,000 px repaint
// to defer.
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
