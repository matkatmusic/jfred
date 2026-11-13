// The details pane floats over the bubbles, pinned to the right edge of the scroll box.

import { getRequiredElementById } from "../../app-dom.ts";

export const DEFAULT_PANE_SHARE_PERCENT = 35;
export const MIN_PANE_SHARE_PERCENT = 30;
export const MAX_PANE_SHARE_PERCENT = 50;

const OPTIONAL_OVERLAY_IDS = ["sessionDotLinesComponent", "jfredCommitsDrawerComponent"];

let paneSharePercent = DEFAULT_PANE_SHARE_PERCENT;
// Each test page builds a new scroll box, so the guard is the element itself.
let observedScrollBox: HTMLElement | null = null;

export function computeVisibleBubbleWidth(overlayRightEdgesPx: number[], scrollBoxRightPx: number): number {
    return scrollBoxRightPx - Math.max(...overlayRightEdgesPx);
}

export function computePaneWidthPx(sharePercent: number, visibleWidthPx: number): number {
    return visibleWidthPx * sharePercent / 100;
}

export function readVisibleOverlayRightEdges(): number[] {
    const rightEdges = [getRequiredElementById("timelineRulerComponent").getBoundingClientRect().right];
    for (const id of OPTIONAL_OVERLAY_IDS) {
        const overlay = document.getElementById(id);
        if (overlay !== null) {
            rightEdges.push(overlay.getBoundingClientRect().right);
        }
    }
    return rightEdges;
}

export function storeDetailsPaneSharePercent(sharePercent: number): void {
    paneSharePercent = sharePercent;
}

export function moveDetailsPaneToRightEdge(): void {
    const scrollBox = getRequiredElementById("timelineContainer");
    const scrollBoxRect = scrollBox.getBoundingClientRect();
    // clientWidth leaves out the scrollbar, so the pane never covers it.
    const scrollBoxRight = scrollBoxRect.left + scrollBox.clientWidth;
    const visibleWidth = computeVisibleBubbleWidth(readVisibleOverlayRightEdges(), scrollBoxRight);
    const paneWidth = computePaneWidthPx(paneSharePercent, visibleWidth);
    const pane = getRequiredElementById("detailsPaneContainer");
    pane.style.left = `${scrollBoxRight - paneWidth}px`;
    pane.style.top = `${scrollBoxRect.top}px`;
    pane.style.width = `${paneWidth}px`;
    pane.style.height = `${scrollBox.clientHeight}px`;
}

function moveOpenDetailsPane(): void {
    const isOpen = getRequiredElementById("detailsPaneContainer").classList.contains("open");
    if (isOpen) {
        moveDetailsPaneToRightEdge();
    }
}

// The canvas observer also fires on a zoom change.
function attachPanePlacementObserver(): void {
    const scrollBox = getRequiredElementById("timelineContainer");
    if (scrollBox === observedScrollBox) {
        return;
    }
    const canvas = scrollBox.querySelector(".canvas");
    if (canvas === null) {
        throw new Error("timelineContainer has no .canvas");
    }
    observedScrollBox = scrollBox;
    const observer = new window.ResizeObserver(moveOpenDetailsPane);
    observer.observe(scrollBox);
    observer.observe(canvas);
}

export function openDetailsPane(): void {
    getRequiredElementById("detailsPaneContainer").classList.add("open");
    attachPanePlacementObserver();
    moveDetailsPaneToRightEdge();
}

export function closeDetailsPane(): void {
    getRequiredElementById("detailsPaneContainer").classList.remove("open");
}
