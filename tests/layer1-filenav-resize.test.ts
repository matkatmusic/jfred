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

function readFileNavWidth(): string {
    return document.getElementById("stagewrap")!.style.getPropertyValue("--filenav-w");
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
