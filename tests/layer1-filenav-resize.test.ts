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
    return document.getElementById("stagewrap")!.style.getPropertyValue("--filenav-w");
}

function readFileNavDragWidth(): string {
    return document.getElementById("stagewrap")!.style.getPropertyValue("--filenav-drag-w");
}

function readFrozenTimelineWidth(): string {
    return document.getElementById("stagewrap")!.style.getPropertyValue("--timeline-w");
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
    assert.ok(document.getElementById("stagewrap")!.classList.contains("resizing"));
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
    assert.equal(document.getElementById("stagewrap")!.classList.contains("resizing"), false);
    assert.equal(readFrozenTimelineWidth(), "");
});
