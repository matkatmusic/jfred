// Task 279: File Nav drag-to-resize. Tests assert the custom property the drag writes, because happy-dom has no layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");

// A booted page, wired by initLayer1Page exactly as the browser wires it.
function openResizablePage(): void {
    initLayer1Dom();
    initLayer1Page();
}

// Drive one complete drag: press the grip, move to `clientX`, release. MouseEvent carries clientX in happy-dom.
function dragGripTo(clientX: number): void {
    const grip = document.getElementById("filenav-grip")!;
    grip.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 232 }));
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX }));
    window.dispatchEvent(new window.MouseEvent("pointerup", { clientX }));
}

// Press and move WITHOUT releasing, so the in-progress state is observable.
function startDragToward(clientX: number): void {
    const grip = document.getElementById("filenav-grip")!;
    grip.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 232 }));
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX }));
}

function readFileNavWidth(): string {
    return document.getElementById("sessionDataContainer")!.style.getPropertyValue("--filenav-w");
}

function readFileNavDragWidth(): string {
    return document.getElementById("sessionDataContainer")!.style.getPropertyValue("--filenav-drag-w");
}

function readFrozenTimelineWidth(): string {
    return document.getElementById("sessionDataContainer")!.style.getPropertyValue("--timeline-w");
}

test("test_dragging_the_grip_writes_the_shared_filenav_width", () => {
    // Scenario (task 279): one shared property sets pane width and minimap left. Steps: drag the grip to 340 px.
    openResizablePage();
    dragGripTo(340);
    // the shared property carries the new width.
    assert.equal(readFileNavWidth(), "340px");
});

test("test_the_dragged_filenav_width_stops_at_its_minimum", () => {
    // Scenario: a drag past the left edge must not collapse the pane. Steps: drag far left.
    openResizablePage();
    dragGripTo(-200);
    // the width clamped to the floor rather than following the pointer.
    assert.equal(readFileNavWidth(), "120px");
});

test("test_a_pointer_move_after_the_drag_ends_does_not_resize", () => {
    // Scenario: release must remove the window listeners, or later moves resize the pane. Steps: drag, then move.
    openResizablePage();
    dragGripTo(340);
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 500 }));
    // the width is still where the drag left it.
    assert.equal(readFileNavWidth(), "340px");
});

test("test_a_drag_in_progress_moves_the_preview_and_not_the_pane", () => {
    // Scenario (task 288): while the button is down, only the preview moves, so the canvas is not relaid out.
    openResizablePage();
    startDragToward(340);
    // the preview carries the pointer's width...
    assert.equal(readFileNavDragWidth(), "340px");
    // ...and the pane's own width has not moved off its default, so nothing relaid out.
    assert.equal(readFileNavWidth(), "");
    // and the grip reads as a live preview line.
    assert.ok(document.getElementById("filenav-grip")!.classList.contains("dragging"));
    // 2026-07-26 follow-up: the timeline is frozen during the drag; CSS needs both `.resizing` and `--timeline-w`.
    assert.ok(document.getElementById("sessionDataContainer")!.classList.contains("resizing"));
    assert.notEqual(readFrozenTimelineWidth(), "");
});

test("test_releasing_the_drag_commits_the_width_and_drops_the_preview", () => {
    // Scenario (task 288): the real width is written once, on release. Steps: open the page, drag out to 340px.
    openResizablePage();
    dragGripTo(340);
    // the pane's shared width is committed...
    assert.equal(readFileNavWidth(), "340px");
    // ...the preview property is gone, so `.filenav-grip` falls back to reading the committed width.
    assert.equal(readFileNavDragWidth(), "");
    // ...and the grip is no longer painted as a drag in progress.
    assert.equal(document.getElementById("filenav-grip")!.classList.contains("dragging"), false);
    // ...and the timeline's freeze is lifted, so a leftover half would pin a stale width.
    assert.equal(document.getElementById("sessionDataContainer")!.classList.contains("resizing"), false);
    assert.equal(readFrozenTimelineWidth(), "");
});

// happy-dom has no layout, so give #sourcesContainer a fixed box: top 0, height `height`.
function stubSourcesContainerHeight(height: number): void {
    const sourcesContainer = document.getElementById("sourcesContainer")!;
    Object.defineProperty(sourcesContainer, "getBoundingClientRect", {
        value: () => ({ top: 0, left: 0, width: 232, height, right: 232, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
    });
}

// Drive one complete drag of the row grip between the two panes: press, move, release.
function dragPaneGripTo(clientY: number): void {
    const grip = document.getElementById("navpane-grip")!;
    grip.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientY }));
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientY }));
    window.dispatchEvent(new window.MouseEvent("pointerup", { clientY }));
}

function readFileNavGrow(): number {
    return Number(document.getElementById("fileNavComponent")!.style.flexGrow);
}

function readJsonlsGrow(): number {
    return Number(document.getElementById("jsonlsComponent")!.style.flexGrow);
}

test("test_dragging_the_pane_grip_down_gives_the_top_pane_more_grow", () => {
    // Scenario: dragging the row grip down grows the top pane and shrinks the bottom one. Steps: height 400, drag to 280.
    openResizablePage();
    stubSourcesContainerHeight(400);
    dragPaneGripTo(280);
    // the top pane has more grow than the bottom pane.
    assert.ok(readFileNavGrow() > readJsonlsGrow());
    // the two grows still sum to 5.
    assert.ok(Math.abs(readFileNavGrow() + readJsonlsGrow() - 5) < 1e-9);
    // 280 of 400 is 70 percent, so the top pane gets 3.5.
    assert.ok(Math.abs(readFileNavGrow() - 3.5) < 1e-9);
});

test("test_dragging_the_pane_grip_stops_when_a_pane_would_be_under_80_px", () => {
    // Scenario: a drag past the top edge must not squash the top pane. Steps: height 400, drag to 10.
    openResizablePage();
    stubSourcesContainerHeight(400);
    dragPaneGripTo(10);
    // the top pane stops at 80 of 400 px, which is 1 of 5.
    assert.ok(Math.abs(readFileNavGrow() - 1) < 1e-9);
    // the bottom pane keeps the other 4.
    assert.ok(Math.abs(readJsonlsGrow() - 4) < 1e-9);
});

test("test_pane_grip_sits_between_the_two_panes", () => {
    // Scenario: the row grip is the divider between the File Nav pane and the JSONLs pane. Steps: open the page.
    openResizablePage();
    // the element after the File Nav pane is the grip.
    assert.equal(document.getElementById("fileNavComponent")!.nextElementSibling!.id, "navpane-grip");
    // the element after the grip is the JSONLs pane.
    assert.equal(document.getElementById("navpane-grip")!.nextElementSibling!.id, "jsonlsComponent");
});

test("test_pane_grip_release_stops_following_the_pointer", () => {
    // Scenario: release must remove the window listeners. Steps: height 400, drag to 280 and release, then move to 100.
    openResizablePage();
    stubSourcesContainerHeight(400);
    dragPaneGripTo(280);
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientY: 100 }));
    // the top pane is still where the drag left it.
    assert.ok(Math.abs(readFileNavGrow() - 3.5) < 1e-9);
});
