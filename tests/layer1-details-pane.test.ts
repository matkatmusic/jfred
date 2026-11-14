// The details pane sits on the right edge of the timeline scroll box; its width is a share of the bubble area no overlay covers.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import {
    DEFAULT_PANE_SHARE_PERCENT, closeDetailsPane, computePaneShareFromPointer, computeVisibleBubbleWidth, installDetailsPaneResize,
    openDetailsPane, storeDetailsPaneSharePercent,
} from "../webapp/layer1-components/details-drawer/layer1-details-pane.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

let observerCallbacks: Array<() => void> = [];

class CapturingResizeObserver {
    constructor(callback: () => void) {
        observerCallbacks.push(callback);
    }
    observe(_target: unknown): void {}
    unobserve(_target: unknown): void {}
    disconnect(): void {}
}

interface StubbedLayout {
    left?: number;
    right?: number;
    top?: number;
    clientWidth?: number;
    clientHeight?: number;
}

function stubLayout(element: Element, layout: StubbedLayout): void {
    const left = layout.left ?? 0;
    const right = layout.right ?? 0;
    const top = layout.top ?? 0;
    const rect = { left, right, top, bottom: top, width: right - left, height: 0, x: left, y: top, toJSON() { return {}; } };
    Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => rect });
    if (layout.clientWidth !== undefined) {
        Object.defineProperty(element, "clientWidth", { configurable: true, value: layout.clientWidth });
    }
    if (layout.clientHeight !== undefined) {
        Object.defineProperty(element, "clientHeight", { configurable: true, value: layout.clientHeight });
    }
}

function addOverlay(overlayId: string, right: number): HTMLElement {
    const overlay = createElement("div", { id: overlayId });
    getRequiredElementById("timelineRulerContainer").appendChild(overlay);
    stubLayout(overlay, { right });
    return overlay;
}

function getPane(): HTMLElement {
    return getRequiredElementById("detailsPaneContainer");
}

beforeEach(() => {
    initLayer1Dom();
    storeDetailsPaneSharePercent(DEFAULT_PANE_SHARE_PERCENT);
    observerCallbacks = [];
    Object.assign(window, { ResizeObserver: CapturingResizeObserver });
    stubLayout(getRequiredElementById("timelineContainer"), { left: 0, top: 50, clientWidth: 1200, clientHeight: 600 });
    stubLayout(getRequiredElementById("timelineRulerComponent"), { right: 200 });
});

test("test_visible_width_runs_from_the_rightmost_overlay_right_edge_to_the_scroll_box_right_edge", () => {
    // Three overlays end at 200, 400 and 300; the scroll box ends at 1200.
    const visibleWidth = computeVisibleBubbleWidth([200, 400, 300], 1200);
    // The largest edge (400) is the start, so 1200 - 400 = 800.
    assert.equal(visibleWidth, 800);
});

test("test_visible_width_with_one_overlay_is_scroll_box_right_minus_that_edge", () => {
    // One overlay ends at 200; the scroll box ends at 1200.
    const visibleWidth = computeVisibleBubbleWidth([200], 1200);
    assert.equal(visibleWidth, 1000);
});

test("test_the_first_open_width_is_35_percent_of_the_visible_bubble_width", () => {
    // Only the ruler covers the left 200px, so 1000px is visible.
    openDetailsPane();
    // 35% of 1000 is 350.
    assert.equal(getPane().style.width, "350px");
});

test("test_the_pane_is_narrower_when_the_session_lines_are_shown", () => {
    // The session lines end at 400, so 800px is visible.
    addOverlay("sessionDotLinesComponent", 400);
    openDetailsPane();
    // 35% of 800 is 280.
    assert.equal(getPane().style.width, "280px");
});

test("test_the_pane_is_narrower_when_the_commits_drawer_is_shown", () => {
    // The commits drawer ends at 500, so 700px is visible.
    addOverlay("jfredCommitsDrawerComponent", 500);
    openDetailsPane();
    // 35% of 700 is 245.
    assert.equal(getPane().style.width, "245px");
});

test("test_the_rightmost_visible_overlay_sets_the_pane_start", () => {
    // The session lines end at 400 and the commits drawer ends at 600.
    addOverlay("sessionDotLinesComponent", 400);
    addOverlay("jfredCommitsDrawerComponent", 600);
    openDetailsPane();
    // The drawer is the rightmost, so 600px is visible: 35% is 210.
    assert.equal(getPane().style.width, "210px");
});

test("test_a_hidden_overlay_does_not_count", () => {
    // The session lines are in the page, then the app removes them.
    const sessionLines = addOverlay("sessionDotLinesComponent", 400);
    sessionLines.remove();
    openDetailsPane();
    // Only the ruler counts, so the width is the same as with no overlay.
    assert.equal(getPane().style.width, "350px");
});

test("test_a_second_open_keeps_the_width_the_user_dragged", () => {
    // The user dragged the pane to 42 percent.
    storeDetailsPaneSharePercent(42);
    openDetailsPane();
    closeDetailsPane();
    openDetailsPane();
    // 42% of 1000 is 420.
    assert.equal(getPane().style.width, "420px");
});

test("test_the_pane_width_follows_a_resize_of_the_scroll_box", () => {
    // The pane is open on a 1200px wide scroll box.
    openDetailsPane();
    // The scroll box grows to 1600px and the resize observer fires.
    stubLayout(getRequiredElementById("timelineContainer"), { left: 0, top: 50, clientWidth: 1600, clientHeight: 600 });
    assert.equal(observerCallbacks.length, 1);
    observerCallbacks[0]!();
    // 1400px is visible; 35% of 1400 is 490.
    assert.equal(getPane().style.width, "490px");
});

test("test_closing_the_pane_removes_open_and_keeps_the_pane_in_place", () => {
    // Open the pane and note where it sits.
    openDetailsPane();
    const parentWhileOpen = getPane().parentElement;
    // Close it.
    closeDetailsPane();
    // The open class is gone and the pane is still in the same parent.
    assert.equal(getPane().classList.contains("open"), false);
    assert.equal(getPane().parentElement, parentWhileOpen);
});

test("test_pane_position_is_the_right_edge_of_the_scroll_box", () => {
    // Open the pane on a scroll box at left 0, top 50, 1200px wide, 600px tall.
    openDetailsPane();
    const style = getPane().style;
    // The pane ends exactly on the scroll box right edge.
    assert.equal(parseFloat(style.left) + parseFloat(style.width), 1200);
    // The pane starts at the scroll box top and is as tall as the scroll box.
    assert.equal(style.top, "50px");
    assert.equal(style.height, "600px");
});

function getPaneGrip(): HTMLElement {
    return getRequiredElementById("details-pane-grip");
}

function dragPaneGripTo(clientX: number): void {
    getPaneGrip().dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX }));
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX }));
    window.dispatchEvent(new window.MouseEvent("pointerup", { clientX }));
}

test("test_pane_share_from_pointer_is_the_distance_to_the_scroll_box_right_as_a_percent_of_the_visible_width", () => {
    // The pointer is at 800, the scroll box ends at 1200, and 1000px is visible.
    const share = computePaneShareFromPointer(800, 1200, 1000);
    // 400px of 1000px is 40 percent.
    assert.equal(share, 40);
});

test("test_pane_share_from_pointer_stops_at_50_percent", () => {
    // The pointer is far to the left of the scroll box.
    const share = computePaneShareFromPointer(-5000, 1200, 1000);
    assert.equal(share, 50);
});

test("test_pane_share_from_pointer_stops_at_30_percent", () => {
    // The pointer is far to the right of the scroll box edge.
    const share = computePaneShareFromPointer(5000, 1200, 1000);
    assert.equal(share, 30);
});

test("test_dragging_the_pane_grip_left_widens_the_pane", () => {
    // The pane is open at 350px and the grip is wired.
    openDetailsPane();
    installDetailsPaneResize();
    // Drag the grip to x 800: 400px of the 1000px visible.
    dragPaneGripTo(800);
    assert.equal(getPane().style.width, "400px");
});

test("test_dragging_the_pane_grip_far_left_stops_at_50_percent", () => {
    openDetailsPane();
    installDetailsPaneResize();
    // Drag far to the left.
    dragPaneGripTo(-5000);
    // 50% of 1000 is 500.
    assert.equal(getPane().style.width, "500px");
});

test("test_dragging_the_pane_grip_far_right_stops_at_30_percent", () => {
    openDetailsPane();
    installDetailsPaneResize();
    // Drag far to the right.
    dragPaneGripTo(5000);
    // 30% of 1000 is 300.
    assert.equal(getPane().style.width, "300px");
});

test("test_the_drag_limit_at_the_far_left_follows_the_visible_part_when_the_session_lines_are_shown", () => {
    // The session lines end at 400, so 800px is visible.
    addOverlay("sessionDotLinesComponent", 400);
    openDetailsPane();
    installDetailsPaneResize();
    dragPaneGripTo(-5000);
    // 50% of 800 is 400.
    assert.equal(getPane().style.width, "400px");
});

test("test_the_drag_limit_at_the_far_right_follows_the_visible_part_when_the_session_lines_are_shown", () => {
    // The session lines end at 400, so 800px is visible.
    addOverlay("sessionDotLinesComponent", 400);
    openDetailsPane();
    installDetailsPaneResize();
    dragPaneGripTo(5000);
    // 30% of 800 is 240.
    assert.equal(getPane().style.width, "240px");
});

test("test_dragging_the_pane_grip_stays_inside_one_pointer_gesture", () => {
    openDetailsPane();
    installDetailsPaneResize();
    // One full gesture ends at 800: 400px.
    dragPaneGripTo(800);
    // A later pointer move without a press on the grip.
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 700 }));
    // The width stays at 400px.
    assert.equal(getPane().style.width, "400px");
});

test("test_pane_grip_drag_does_not_open_a_closed_pane", () => {
    // The pane is closed.
    installDetailsPaneResize();
    dragPaneGripTo(800);
    assert.equal(getPane().classList.contains("open"), false);
});

test("test_pane_grip_drag_does_not_close_an_open_pane", () => {
    openDetailsPane();
    installDetailsPaneResize();
    dragPaneGripTo(800);
    assert.equal(getPane().classList.contains("open"), true);
});

test("test_the_pane_grip_is_the_first_child_of_the_details_pane", () => {
    assert.equal(getPane().firstElementChild, getPaneGrip());
});

test("test_a_second_open_keeps_the_width_the_user_dragged_with_the_grip", () => {
    openDetailsPane();
    installDetailsPaneResize();
    // Drag to x 800: 40%.
    dragPaneGripTo(800);
    closeDetailsPane();
    openDetailsPane();
    // 40% of 1000 is 400.
    assert.equal(getPane().style.width, "400px");
});
