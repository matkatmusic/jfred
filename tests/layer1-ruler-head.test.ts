// Task L9 redo: the ruler head holds one `session` button and is rebuilt as the first child of #ruler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { removeRulerHead, renderRulerHead } from "../webapp/layer1-components/ruler/layer1-ruler-head.ts";

function readRuler(): HTMLElement {
    return document.getElementById("ruler")!;
}

test("test_the_head_is_the_first_child_with_one_session_button", () => {
    initLayer1Dom();
    renderRulerHead(false, () => {});
    const head = readRuler().firstElementChild!;
    assert.equal(head.id, "ruler-head");
    assert.equal(head.querySelectorAll("button").length, 1);
    const button = head.querySelector("button")!;
    assert.equal(button.id, "session-toggle");
    assert.equal(button.textContent, "session");
    assert.ok(!button.classList.contains("current"));
});

test("test_the_button_has_class_current_when_on", () => {
    initLayer1Dom();
    renderRulerHead(true, () => {});
    assert.ok(document.getElementById("session-toggle")!.classList.contains("current"));
});

test("test_a_click_calls_the_toggle_once", () => {
    initLayer1Dom();
    let clicks = 0;
    renderRulerHead(false, () => clicks++);
    document.getElementById("session-toggle")!.click();
    assert.equal(clicks, 1);
});

test("test_a_second_render_keeps_one_head_and_one_click_per_toggle", () => {
    initLayer1Dom();
    let clicks = 0;
    renderRulerHead(false, () => clicks++);
    renderRulerHead(true, () => clicks++);
    assert.equal(document.querySelectorAll("#ruler-head").length, 1);
    document.getElementById("session-toggle")!.click();
    assert.equal(clicks, 1);
});

test("test_the_head_returns_to_first_after_the_ruler_children_are_replaced", () => {
    initLayer1Dom();
    renderRulerHead(false, () => {});
    readRuler().replaceChildren(document.createElement("div"));
    renderRulerHead(false, () => {});
    assert.equal(readRuler().firstElementChild!.id, "ruler-head");
});

test("test_remove_deletes_the_head_and_a_second_remove_is_quiet", () => {
    initLayer1Dom();
    renderRulerHead(false, () => {});
    removeRulerHead();
    removeRulerHead();
    assert.equal(document.getElementById("ruler-head"), null);
});
