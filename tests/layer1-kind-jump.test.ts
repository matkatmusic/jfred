// The show row's < and > arrows jump the timeline to the nearest node of one kind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findArrow, PANE_HEIGHT_PX, readLandedY, renderViewWithSyntheticStage } from "./layer1-kind-jump-helpers.ts";

test("test_each_kind_box_has_a_previous_and_a_next_arrow_under_it", async () => {
    await renderViewWithSyntheticStage();
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
        const column = box.closest(".show-kind-col")!;
        const labelRow = column.querySelector("label.show-kind")!;
        const arrows = [...column.querySelectorAll<HTMLButtonElement>("button")];
        assert.deepEqual(arrows.map((arrow) => arrow.textContent), ["<", ">"]);
        assert.ok(arrows.every((arrow) => arrow.type === "button"));
        assert.equal(labelRow.querySelector("input"), box);
        assert.ok(arrows.every((arrow) => !labelRow.contains(arrow)));
    }
});

test("test_next_lands_on_the_nearest_node_after_the_view_and_a_second_next_steps_further", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "400");
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "700");
});

test("test_an_arrow_landing_centres_the_node_in_the_visible_timeline", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    const box = document.querySelector<HTMLElement>("#stage .found")!.getBoundingClientRect();
    assert.equal((box.top + box.bottom) / 2, PANE_HEIGHT_PX / 2);
});

test("test_previous_steps_back_from_the_landed_node", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    findArrow("commit", "next").click();
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "400");
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "100");
});

test("test_after_the_user_scrolls_the_pane_an_arrow_steps_from_the_view_centre_not_the_landed_node", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "400");
    document.getElementById("timelines")!.scrollTop = 500;
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "400");
});

test("test_an_arrow_with_no_node_in_its_direction_is_disabled", async () => {
    await renderViewWithSyntheticStage();
    assert.equal(findArrow("commit", "previous").disabled, false);
    findArrow("commit", "next").click();
    findArrow("commit", "next").click();
    assert.equal(findArrow("commit", "next").disabled, true);
    assert.equal(findArrow("commit", "previous").disabled, false);
});

test("test_a_kind_jump_does_not_toggle_the_checkbox", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row input[data-kind=commit]")!.checked, true);
});

