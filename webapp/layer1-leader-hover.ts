// Task 290, second half (user, 2026-07-26): "when you mouse over a leader line and the node(s) or bubble(s) it is pointing to is/are in the visible part of the timeline, highlight those nodes and make the dashed leader line's color change to the same highlight color used for nodes and bubbles." Its own module rather than more of layer1-page.ts, which is at 220 of the repo's 250-line cap, and this is a second behaviour rather than a variation on the ruler-tick click.

import { getRequiredElementById } from "./app-dom.ts";
import { listElementsDrawnAtAxisPx, readAxisPx } from "./layer1-ruler-click.ts";

// The class the CSS paints the "this line points HERE" state from. Deliberately NOT `.found`: that is tasks 283/267's single persistent selection, and this is a transient set of several elements.
const AIMED_CLASS = "aimed";

// What the pointer is currently over, so leaving can darken exactly what entering lit.
let aimedElements: HTMLElement[] = [];

function clearAimedElements(): void {
    for (const element of aimedElements) {
        element.classList.remove(AIMED_CLASS);
    }
    aimedElements = [];
}

// Whether an element overlaps the timeline pane's scrollport AT ALL, which is the user's condition ("...is/are in the visible part of the timeline"). The pane, not the window: `main.timelines` is the scroll container, so anything outside its box has been scrolled away even though it is still in the document. Rect-vs-rect, so it is correct under the native `zoom` on `.canvas` — both rects are post-layout.
function isInsideVisibleTimeline(element: HTMLElement): boolean {
    const pane = getRequiredElementById("timelines").getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.right > pane.left && box.left < pane.right
        && box.bottom > pane.top && box.top < pane.bottom;
}

// Light the line and everything it points at, or nothing at all: the user asked for the recolour only when a target is actually on screen, so a line whose bubbles are all scrolled away stays grey rather than promising a target the reader cannot find.
function aimLeaderAtVisibleTargets(leader: HTMLElement): void {
    clearAimedElements();
    const visible = listElementsDrawnAtAxisPx(readAxisPx(leader)).filter(isInsideVisibleTimeline);
    if (visible.length === 0) {
        return;
    }
    aimedElements = [leader, ...visible];
    for (const element of aimedElements) {
        element.classList.add(AIMED_CLASS);
    }
}

// Wire one already-positioned leader and hand it back, exactly as makeRulerTickClickable does, so layer1-page.ts's renderLeaderLines stays a single expression. `pointerenter`/`pointerleave` and not `pointerover`/`pointerout`: a leader has no children, and the enter/leave pair does not fire again as the pointer travels along the same line.
export function makeLeaderHoverable(leader: HTMLElement): HTMLElement {
    leader.addEventListener("pointerenter", () => aimLeaderAtVisibleTargets(leader));
    leader.addEventListener("pointerleave", clearAimedElements);
    return leader;
}
