// The minimap lives in the ruler container; its left edge is the rightmost ruler-side edge and its bottom is the scroll box bottom.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { clearFileBubbles } from "../webapp/layer1-components/bubbles/layer1-file-bubbles-clear.ts";
import { renderLayer1Minimap } from "../webapp/layer1-components/minimap/layer1-minimap.ts";
import { computeMinimapLeftPx, moveMiniMapToRulerEdge } from "../webapp/layer1-components/minimap/layer1-minimap-position.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const WINDOW_HEIGHT_PX = 900;
const SCROLL_BOX_BOTTOM_PX = 700;
const BOTTOM_GAP_PX = 12;

function stubRect(element: Element, rect: { right: number; bottom?: number }): void {
    const bottom = rect.bottom ?? 0;
    const fullRect = { left: 0, right: rect.right, top: 0, bottom, width: rect.right, height: bottom, x: 0, y: 0, toJSON() { return {}; } };
    Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => fullRect });
}

function addOverlay(overlayId: string, right: number): HTMLElement {
    const overlay = createElement("div", { id: overlayId });
    getRequiredElementById("timelineRulerContainer").appendChild(overlay);
    stubRect(overlay, { right });
    return overlay;
}

function getMinimap(): HTMLElement {
    return getRequiredElementById("minimapComponent");
}

beforeEach(() => {
    initLayer1Dom();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: WINDOW_HEIGHT_PX });
    stubRect(getRequiredElementById("timelineContainer"), { right: 1200, bottom: SCROLL_BOX_BOTTOM_PX });
    stubRect(getRequiredElementById("timelineRulerContainer"), { right: 200 });
});

test("test_minimap_left_is_the_largest_right_edge", () => {
    // Three edges end at 200, 400 and 300.
    const left = computeMinimapLeftPx([200, 400, 300]);
    // The largest edge is the answer.
    assert.equal(left, 400);
});

test("test_minimap_is_a_child_of_the_timeline_ruler_container", () => {
    // The real built layout puts the minimap inside the ruler container.
    assert.equal(getMinimap().parentElement, getRequiredElementById("timelineRulerContainer"));
});

test("test_minimap_left_edge_is_the_ruler_container_right_edge_when_nothing_else_is_shown", () => {
    // The ruler container ends at 200 and no other overlay exists.
    moveMiniMapToRulerEdge();
    assert.equal(getMinimap().style.left, "200px");
});

test("test_minimap_left_edge_is_the_commits_drawer_right_edge_when_that_is_further_right", () => {
    // The commits drawer ends at 500, past the ruler container at 200.
    addOverlay("jfredCommitsDrawerComponent", 500);
    moveMiniMapToRulerEdge();
    assert.equal(getMinimap().style.left, "500px");
});

test("test_minimap_left_edge_is_the_ruler_container_right_edge_when_that_is_further_right", () => {
    // The commits drawer ends at 150, before the ruler container at 200.
    addOverlay("jfredCommitsDrawerComponent", 150);
    moveMiniMapToRulerEdge();
    assert.equal(getMinimap().style.left, "200px");
});

test("test_minimap_moves_when_the_session_lines_appear", () => {
    // Before the session lines, the minimap sits at the ruler container edge.
    moveMiniMapToRulerEdge();
    assert.equal(getMinimap().style.left, "200px");
    // The session lines appear and the ruler container grows to 400.
    addOverlay("sessionDotLinesComponent", 400);
    stubRect(getRequiredElementById("timelineRulerContainer"), { right: 400 });
    moveMiniMapToRulerEdge();
    assert.equal(getMinimap().style.left, "400px");
});

test("test_minimap_does_not_follow_a_scroll", () => {
    // Place the minimap, then remember where it is.
    moveMiniMapToRulerEdge();
    const leftBeforeScroll = getMinimap().style.left;
    const bottomBeforeScroll = getMinimap().style.bottom;
    // Scroll the scroll box both ways and fire the scroll event.
    const scrollBox = getRequiredElementById("timelineContainer");
    scrollBox.scrollLeft = 600;
    scrollBox.scrollTop = 600;
    scrollBox.dispatchEvent(new window.Event("scroll"));
    // The minimap did not move.
    assert.equal(getMinimap().style.left, leftBeforeScroll);
    assert.equal(getMinimap().style.bottom, bottomBeforeScroll);
});

test("test_minimap_sits_at_the_bottom_of_the_scroll_box", () => {
    // The window is 900 tall and the scroll box bottom is 700.
    moveMiniMapToRulerEdge();
    // 900 - 700 + 12 = 212.
    assert.equal(getMinimap().style.bottom, `${WINDOW_HEIGHT_PX - SCROLL_BOX_BOTTOM_PX + BOTTOM_GAP_PX}px`);
});

test("test_rendering_the_minimap_moves_it_to_the_ruler_edge", () => {
    // Stub the sizes the render reads (copied from the minimap test).
    const scrollBox = getRequiredElementById("timelineContainer");
    for (const [property, value] of Object.entries({ scrollWidth: 1000, scrollHeight: 250, clientWidth: 200, clientHeight: 100 })) {
        Object.defineProperty(scrollBox, property, { value, configurable: true });
    }
    const plot = document.querySelector(".mm-plot")!;
    for (const [property, value] of Object.entries({ clientWidth: 100, clientHeight: 50 })) {
        Object.defineProperty(plot, property, { value, configurable: true });
    }
    const widget = createElement("div", { class: "filebox" });
    stubRect(widget, { right: 268 });
    const bubbleContainer = getRequiredElementById("fileBubbleContainer");
    clearFileBubbles(bubbleContainer);
    bubbleContainer.append(widget);
    // The render ends by placing the minimap at the ruler container edge (200).
    renderLayer1Minimap();
    assert.equal(getMinimap().style.left, "200px");
});
