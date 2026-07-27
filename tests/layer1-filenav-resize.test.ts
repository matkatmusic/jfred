// Task 279: the File Nav pane's drag-to-resize. What is asserted is the one custom property the
// drag writes, NOT a rendered width — happy-dom has no layout, so a width assertion would measure
// happy-dom. The property IS the contract: layer1-styles.css gives .filenav's width and .minimap's
// left the same var(--filenav-w), so anything that moves it moves both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// A booted page, wired by bootLayer1Page exactly as the browser wires it.
function openResizablePage(): void {
    setupLayer1Dom();
    bootLayer1Page();
}

// Drive one complete drag: press on the grip, move the pointer to `clientX`, release.
// MouseEvent rather than PointerEvent: listeners are keyed by the type STRING, and MouseEvent is
// what carries clientX in happy-dom.
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
    // Scenario (task 279): the user asked for the pane's right edge to be draggable. The drag
    // writes ONE property, which both the pane's width and the minimap's left read — so the
    // minimap cannot drift over the pane as the pane grows.
    // Steps:
    // open the page and drag the grip out to 340 px.
    openResizablePage();
    dragGripTo(340);
    // the shared property carries the new width.
    assert.equal(readFileNavWidth(), "340px");
});

test("test_the_dragged_filenav_width_stops_at_its_minimum", () => {
    // Scenario: dragging past the left edge would otherwise collapse the pane to zero — or to a
    // negative width — leaving no grip to drag back out with, which is unrecoverable without a
    // reload.
    // Steps:
    // open the page and drag the grip far past the left edge.
    openResizablePage();
    dragGripTo(-200);
    // the width clamped to the floor rather than following the pointer.
    assert.equal(readFileNavWidth(), "120px");
});

test("test_a_pointer_move_after_the_drag_ends_does_not_resize", () => {
    // Scenario: the move and release listeners live on the WINDOW so a fast drag that outruns the
    // 6 px grip keeps resizing. That only stays correct if the release removes them — otherwise
    // every later mouse movement anywhere on the page would resize the pane.
    // Steps:
    // open the page, complete one drag, then move the pointer again with no button down.
    openResizablePage();
    dragGripTo(340);
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 500 }));
    // the width is still where the drag left it.
    assert.equal(readFileNavWidth(), "340px");
});

test("test_a_drag_in_progress_moves_the_preview_and_not_the_pane", () => {
    // Scenario (task 288): every pointermove used to write the pane's own width, and the pane is a
    // flex sibling of the ~156,000px timeline canvas, so each move relaid out the whole canvas and
    // the drag was unusable. Only the preview property may move while the button is down.
    // Steps:
    // open the page and press-and-move without releasing.
    openResizablePage();
    startDragToward(340);
    // the preview carries the pointer's width...
    assert.equal(readFileNavDragWidth(), "340px");
    // ...and the pane's own width has not moved off its default, so nothing relaid out.
    assert.equal(readFileNavWidth(), "");
    // and the grip reads as a live preview line.
    assert.ok(document.getElementById("filenav-grip")!.classList.contains("dragging"));
    // The 2026-07-26 follow-up: the PANE follows too, which it can only do safely while the
    // timeline pane is frozen at the width it already had — `.resizing` plus a captured
    // `--timeline-w` are the two halves of that freeze, and CSS needs both.
    assert.ok(document.getElementById("stagewrap")!.classList.contains("resizing"));
    assert.notEqual(readFrozenTimelineWidth(), "");
});

test("test_releasing_the_drag_commits_the_width_and_drops_the_preview", () => {
    // Scenario (task 288): the pane must still end up where the user let go — the preview is the
    // only thing that is cheap, so the real width is written exactly once, on release.
    // Steps:
    // open the page and complete a drag out to 340px.
    openResizablePage();
    dragGripTo(340);
    // the pane's shared width is committed...
    assert.equal(readFileNavWidth(), "340px");
    // ...the preview property is gone, so `.filenav-grip` falls back to reading the committed width.
    assert.equal(readFileNavDragWidth(), "");
    // ...and the grip is no longer painted as a drag in progress.
    assert.equal(document.getElementById("filenav-grip")!.classList.contains("dragging"), false);
    // ...and the timeline's freeze is lifted, so it flexes back over the width the nav gave up —
    // leaving either half set would pin the timeline to a stale width for the rest of the session.
    assert.equal(document.getElementById("stagewrap")!.classList.contains("resizing"), false);
    assert.equal(readFrozenTimelineWidth(), "");
});
