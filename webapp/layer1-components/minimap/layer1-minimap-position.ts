// The minimap sits in the ruler container: its left edge is the rightmost ruler-side edge, its bottom is the scroll box bottom.

import { getRequiredElementById } from "../../app-dom.ts";

const GAP_BELOW_MINIMAP_PX = 12;

export function computeMinimapLeftPx(rightEdgesPx: number[]): number {
    return Math.max(...rightEdgesPx);
}

export function moveMiniMapToRulerEdge(): void {
    const minimap = getRequiredElementById("minimapComponent");
    const scrollBoxRect = getRequiredElementById("timelineContainer").getBoundingClientRect();
    const rightEdges = [getRequiredElementById("timelineRulerContainer").getBoundingClientRect().right];
    const commitsDrawer = document.getElementById("jfredCommitsDrawerComponent");
    if (commitsDrawer !== null) {
        rightEdges.push(commitsDrawer.getBoundingClientRect().right);
    }
    minimap.style.left = `${computeMinimapLeftPx(rightEdges)}px`;
    minimap.style.bottom = `${window.innerHeight - scrollBoxRect.bottom + GAP_BELOW_MINIMAP_PX}px`;
}
