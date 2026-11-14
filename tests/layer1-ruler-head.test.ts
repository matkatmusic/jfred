// Task L9 redo + step 27: the ruler head is empty and is rebuilt as the first child of #timelineRulerComponent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { removeRulerHead, renderRulerHead } from "../webapp/layer1-components/ruler/layer1-ruler-head.ts";

function readRuler(): HTMLElement {
    return document.getElementById("timelineRulerComponent")!;
}

test("test_the_head_is_the_first_child_of_the_ruler", () => {
    initLayer1Dom();
    renderRulerHead();
    const head = readRuler().firstElementChild!;
    assert.equal(head.id, "ruler-head");
    assert.ok(head.classList.contains("ruler-head"));
});

test("test_the_ruler_head_has_no_button_any_more", () => {
    initLayer1Dom();
    renderRulerHead();
    const head = document.getElementById("ruler-head")!;
    assert.equal(head.querySelectorAll("button").length, 0);
    assert.equal(head.querySelector("#session-toggle"), null);
});

// The session button moved to #timelineViewControls in step 27: the `current` class test no longer applies to the head.
// test("test_the_button_has_class_current_when_on", () => {
//     initLayer1Dom();
//     renderRulerHead(true, () => {});
//     assert.ok(document.getElementById("session-toggle")!.classList.contains("current"));
// });

// The session button moved to #timelineViewControls in step 27: the click test no longer applies to the head.
// test("test_a_click_calls_the_toggle_once", () => {
//     initLayer1Dom();
//     let clicks = 0;
//     renderRulerHead(false, () => clicks++);
//     document.getElementById("session-toggle")!.click();
//     assert.equal(clicks, 1);
// });

test("test_a_second_render_keeps_one_head", () => {
    initLayer1Dom();
    renderRulerHead();
    renderRulerHead();
    assert.equal(document.querySelectorAll("#ruler-head").length, 1);
});

test("test_the_head_returns_to_first_after_the_ruler_children_are_replaced", () => {
    initLayer1Dom();
    renderRulerHead();
    readRuler().replaceChildren(document.createElement("div"));
    renderRulerHead();
    assert.equal(readRuler().firstElementChild!.id, "ruler-head");
});

test("test_remove_deletes_the_head_and_a_second_remove_is_quiet", () => {
    initLayer1Dom();
    renderRulerHead();
    removeRulerHead();
    removeRulerHead();
    assert.equal(document.getElementById("ruler-head"), null);
});
