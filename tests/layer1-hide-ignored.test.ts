// Task 382: the show row's "hide ignored nodes" box hides ignored column nodes and never affects the kind filter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { buildHideIgnoredControl } = await import("../webapp/layer1-hide-ignored.ts");

function buildControlInShowRow(): HTMLInputElement {
    initLayer1Dom();
    getRequiredElementById("show-row").append(buildHideIgnoredControl());
    return document.querySelector<HTMLInputElement>("#hide-ignored")!;
}

function isHidingIgnored(): boolean {
    return document.querySelector(".viz-root")!.hasAttribute("data-hide-ignored");
}

test("test_the_control_has_the_exact_label_and_starts_checked", () => {
    // Scenario: the label text is "hide ignored nodes" and the box is checked.
    const box = buildControlInShowRow();
    assert.equal(box.type, "checkbox");
    assert.equal(box.checked, true);
    assert.equal(box.closest("label")!.textContent!.trim(), "hide ignored nodes");
    assert.ok(box.closest("label")!.classList.contains("show-ignored"));
});

test("test_the_box_carries_no_data_kind_so_the_kind_filter_ignores_it", () => {
    // Scenario: the kind columns and the arrows select on data-kind; this box must not match.
    buildControlInShowRow();
    assert.equal(document.querySelector("#show-row input[data-kind]"), null);
});

test("test_building_the_control_turns_the_hide_attribute_on", () => {
    // Scenario: ON at page load, before any click.
    buildControlInShowRow();
    assert.equal(isHidingIgnored(), true);
});

test("test_one_click_removes_the_attribute_and_a_second_click_restores_it", () => {
    // Scenario: unchecking shows ignored nodes; checking hides them again.
    const box = buildControlInShowRow();
    box.click();
    assert.equal(box.checked, false);
    assert.equal(isHidingIgnored(), false);
    box.click();
    assert.equal(box.checked, true);
    assert.equal(isHidingIgnored(), true);
});

test("test_the_change_event_never_reaches_a_listener_on_the_show_row", () => {
    // Scenario: the kind filter listens on #show-row; a click on this box must not arrive there.
    const box = buildControlInShowRow();
    let changesSeenOnShowRow = 0;
    function countChange(): void {
        changesSeenOnShowRow += 1;
    }
    getRequiredElementById("show-row").addEventListener("change", countChange);
    box.click();
    assert.equal(changesSeenOnShowRow, 0);
});
