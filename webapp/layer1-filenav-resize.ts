// Task 279: drag the File Nav pane's right edge to resize it.
//
// The drag writes ONE custom property, `--filenav-w`, onto `.stagewrap`. webapp/layer1-styles.css
// gives BOTH `.filenav`'s width and `.minimap`'s `left` that property, so the minimap tracks the
// pane instead of drifting over it — and the duplicated `232px` literal those two rules used to
// share is gone.
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

// The pane's width is the distance from the wrapper's left edge to the pointer: `.filenav` is the
// wrapper's first flex child and starts at that edge, so no measurement of the pane itself is
// needed — and reading the WRAPPER rather than the pane means the number does not depend on the
// width this same drag is changing.
function setFileNavWidthFromPointer(stagewrap: HTMLElement, clientX: number): void {
    const widthPx = clampFileNavWidth(clientX - stagewrap.getBoundingClientRect().left);
    stagewrap.style.setProperty("--filenav-w", `${widthPx}px`);
}

// Wire the grip. Move and release are listened for on the WINDOW, not on the grip: a 6 px handle is
// narrower than a fast drag's per-frame travel, so a grip-bound listener would drop the drag the
// moment the pointer outran it. `setPointerCapture` would do the same job in a browser but is not
// implemented by happy-dom, which is what the tests run on.
export function wireFileNavResize(): void {
    const grip = getRequiredElementById("filenav-grip");
    const stagewrap = getRequiredElementById("stagewrap");
    grip.addEventListener("pointerdown", (event) => {
        // Without this the browser starts a text selection instead, and the drag paints the whole
        // page blue.
        event.preventDefault();
        const resizeToPointer = (move: Event): void => {
            setFileNavWidthFromPointer(stagewrap, (move as MouseEvent).clientX);
        };
        const endResize = (): void => {
            window.removeEventListener("pointermove", resizeToPointer);
            window.removeEventListener("pointerup", endResize);
        };
        window.addEventListener("pointermove", resizeToPointer);
        window.addEventListener("pointerup", endResize);
    });
}
