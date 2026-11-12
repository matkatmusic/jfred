// The Layer 1 header's "Show only modifying events for File" checkbox, tested against the real layer1.html markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const DIM_CLASS = "reverse-modifying-only";
const TOP_BARS_STYLE_FILES = ["sources-legend.css", "jumpbar.css", "header.css"];

function readLabel(): HTMLLabelElement {
    return document.getElementById("reverse-modifying-only") as HTMLLabelElement;
}

function readCheckbox(): HTMLInputElement {
    return readLabel().querySelector("input") as HTMLInputElement;
}

function checkTheBox(isChecked: boolean): void {
    readCheckbox().checked = isChecked;
    readCheckbox().dispatchEvent(new window.Event("change", { bubbles: true }));
}

function addTopBarsStyles(): void {
    const style = document.createElement("style");
    for (const fileName of TOP_BARS_STYLE_FILES) {
        style.textContent += readFileSync(new URL(`../webapp/layer1-components/top-bars/${fileName}`, import.meta.url), "utf8");
    }
    document.head.appendChild(style);
}

async function loadModifyingToggle() {
    initLayer1Dom();
    const modifyingToggle = await import("../webapp/layer1-components/top-bars/layer1-reverse-modifying-toggle.ts");
    modifyingToggle.installReverseModifyingToggle();
    return modifyingToggle;
}

test("test_the_modifying_only_checkbox_follows_the_reverse_button_in_the_jump_bar_and_starts_hidden", () => {
    // Scenario: the labelled checkbox is right after `#reverse-toggle`, inside `.jumpbar`, and hidden until reverse mode shows it.
    initLayer1Dom();
    assert.ok(document.querySelector(".jumpbar")!.contains(readLabel()));
    assert.equal(document.getElementById("reverse-toggle")!.nextElementSibling, readLabel());
    assert.equal(readLabel().textContent!.trim(), "Show only modifying events for File");
    assert.equal(readCheckbox().type, "checkbox");
    assert.equal(readLabel().hidden, true);
});

test("test_the_modifying_only_checkbox_looks_like_a_show_row_checkbox", () => {
    // Scenario: the label uses the show row's `show-kind` class around a plain checkbox.
    initLayer1Dom();
    assert.equal(readLabel().tagName, "LABEL");
    assert.equal(readLabel().classList.contains("show-kind"), true);
});

test("test_showing_the_modifying_only_checkbox_reveals_it_and_false_hides_it_again", async () => {
    // Scenario: show(true) reveals the label; show(false) hides it.
    const modifyingToggle = await loadModifyingToggle();
    modifyingToggle.showReverseModifyingToggle(true);
    assert.equal(readLabel().hidden, false);
    modifyingToggle.showReverseModifyingToggle(false);
    assert.equal(readLabel().hidden, true);
});

test("test_the_hidden_label_is_not_displayed_and_the_shown_label_is_displayed", async () => {
    // Scenario: the page styles must not let a `display` rule beat the `hidden` attribute.
    const modifyingToggle = await loadModifyingToggle();
    addTopBarsStyles();
    assert.equal(window.getComputedStyle(readLabel()).display, "none");
    modifyingToggle.showReverseModifyingToggle(true);
    assert.notEqual(window.getComputedStyle(readLabel()).display, "none");
});

test("test_the_modifying_only_toggle_starts_off", async () => {
    // Scenario: right after install, the state is off, the box is unchecked, and the page is not marked.
    const modifyingToggle = await loadModifyingToggle();
    assert.equal(modifyingToggle.isReverseModifyingOnlyOn(), false);
    assert.equal(readCheckbox().checked, false);
    assert.equal(document.querySelector(".viz-root")!.classList.contains(DIM_CLASS), false);
});

test("test_checking_the_box_turns_modifying_only_on_and_marks_the_page", async () => {
    // Scenario: checking the box flips the state to on and adds the dim class to `.viz-root`.
    const modifyingToggle = await loadModifyingToggle();
    checkTheBox(true);
    assert.equal(modifyingToggle.isReverseModifyingOnlyOn(), true);
    assert.equal(document.querySelector(".viz-root")!.classList.contains(DIM_CLASS), true);
    checkTheBox(false);
});

test("test_unchecking_the_box_turns_modifying_only_off_and_unmarks_the_page", async () => {
    // Scenario: check then uncheck returns the state to off and removes the dim class.
    const modifyingToggle = await loadModifyingToggle();
    checkTheBox(true);
    checkTheBox(false);
    assert.equal(modifyingToggle.isReverseModifyingOnlyOn(), false);
    assert.equal(document.querySelector(".viz-root")!.classList.contains(DIM_CLASS), false);
});
