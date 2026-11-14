// FlexBox turns "rows or columns, grow, min size" into plain CSS flexbox on one element.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { FlexBox } from "../webapp/flex-box.ts";

function createPlainDiv(): HTMLElement {
    return document.createElement("div");
}

test("test_rows_box_stacks_its_children_top_to_bottom", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.rows);
    assert.equal(box.element.style.display, "flex");
    assert.equal(box.element.style.flexDirection, "column");
});

test("test_columns_box_lays_its_children_left_to_right", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.columns);
    assert.equal(box.element.style.display, "flex");
    assert.equal(box.element.style.flexDirection, "row");
});

test("test_added_children_keep_their_add_order", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.rows);
    const first = createPlainDiv();
    const second = createPlainDiv();
    const third = createPlainDiv();
    box.add(first);
    box.add(second);
    box.add(third);
    assert.deepEqual(Array.from(box.element.children), [first, second, third]);
});

test("test_add_grow_and_min_size_in_rows_mode_become_flex_grow_and_min_height", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.rows);
    const child = createPlainDiv();
    box.add(child, { grow: 3, minSize: 80 });
    assert.equal(child.style.flexGrow, "3");
    assert.equal(child.style.minHeight, "80px");
});

test("test_add_grow_and_min_size_in_columns_mode_become_flex_grow_and_min_width", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.columns);
    const child = createPlainDiv();
    box.add(child, { grow: 3, minSize: 80 });
    assert.equal(child.style.flexGrow, "3");
    assert.equal(child.style.minWidth, "80px");
});

test("test_add_without_options_sets_no_flex_grow", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.rows);
    const child = createPlainDiv();
    box.add(child);
    assert.equal(child.style.flexGrow, "");
});

test("test_a_box_can_be_added_to_a_box", () => {
    initLayer1Dom();
    const parent = new FlexBox(FlexBox.layoutModes.rows);
    const childBox = new FlexBox(FlexBox.layoutModes.columns);
    parent.add(childBox);
    assert.equal(childBox.element.parentElement, parent.element);
});

test("test_set_grow_changes_a_childs_flex_grow", () => {
    initLayer1Dom();
    const box = new FlexBox(FlexBox.layoutModes.rows);
    const child = createPlainDiv();
    box.add(child, { grow: 1 });
    box.setGrow(child, 7);
    assert.equal(child.style.flexGrow, "7");
});

test("test_adopting_an_element_keeps_its_id_and_children", () => {
    initLayer1Dom();
    const existing = createPlainDiv();
    existing.id = "adopted";
    const keptChild = createPlainDiv();
    existing.append(keptChild);
    const box = new FlexBox(FlexBox.layoutModes.rows, existing);
    assert.equal(box.element, existing);
    assert.equal(existing.id, "adopted");
    assert.deepEqual(Array.from(existing.children), [keptChild]);
});
