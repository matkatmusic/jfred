// The Layer 1 header's "reverse" toggle, tested against the real layer1.html markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function readButton(): HTMLButtonElement {
    return document.getElementById("reverse-toggle") as HTMLButtonElement;
}

async function loadReverseToggle() {
    initLayer1Dom();
    const reverseToggle = await import("../webapp/layer1-components/top-bars/layer1-reverse-toggle.ts");
    reverseToggle.resetReverseToggle();
    reverseToggle.installReverseToggle();
    return reverseToggle;
}

test("test_the_reverse_button_sits_in_the_jump_bar_after_the_find_status", () => {
    // Scenario: the button is its own element in the jump bar, right after `#find-status`.  Steps: open the real markup.
    initLayer1Dom();
    assert.equal(document.getElementById("find-status")!.nextElementSibling, readButton());
    assert.equal(readButton().parentElement, document.querySelector(".jumpToRowComponent"));
    assert.equal(readButton().textContent, "reverse");
});

test("test_the_reverse_toggle_starts_off", async () => {
    // Scenario: right after install, the state is off and the button is not marked `.current`.
    const reverseToggle = await loadReverseToggle();
    assert.equal(reverseToggle.isReverseOn(), false);
    assert.equal(readButton().classList.contains("current"), false);
});

test("test_the_first_click_turns_reverse_on_and_marks_the_button_current", async () => {
    // Scenario: one click flips the state to on and adds `.current`.
    const reverseToggle = await loadReverseToggle();
    readButton().click();
    assert.equal(reverseToggle.isReverseOn(), true);
    assert.equal(readButton().classList.contains("current"), true);
});

test("test_the_second_click_turns_reverse_off_and_unmarks_the_button", async () => {
    // Scenario: two clicks return the state to off and remove `.current`.
    const reverseToggle = await loadReverseToggle();
    readButton().click();
    readButton().click();
    assert.equal(reverseToggle.isReverseOn(), false);
    assert.equal(readButton().classList.contains("current"), false);
});

test("test_each_click_calls_the_registered_callback", async () => {
    // Scenario: register a callback, click twice, and see two calls.
    const reverseToggle = await loadReverseToggle();
    let callCount = 0;
    reverseToggle.registerReverseChange(() => {
        callCount += 1;
    });
    readButton().click();
    readButton().click();
    assert.equal(callCount, 2);
});

test("test_reset_turns_reverse_off_and_does_not_call_the_callback", async () => {
    // Scenario: turn it on, register a callback, reset, and see state off, class removed, zero calls.
    const reverseToggle = await loadReverseToggle();
    readButton().click();
    let callCount = 0;
    reverseToggle.registerReverseChange(() => {
        callCount += 1;
    });
    reverseToggle.resetReverseToggle();
    assert.equal(reverseToggle.isReverseOn(), false);
    assert.equal(readButton().classList.contains("current"), false);
    assert.equal(callCount, 0);
});
