// Tests for the shared kind-jump test helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNode, findArrow, PANE_HEIGHT_PX, readLandedY, renderViewWithSyntheticStage } from "./layer1-kind-jump-helpers.ts";

test("test_a_built_node_reports_a_box_centred_on_its_content_y", () => {
    const box = buildNode("n-commit", 100).getBoundingClientRect();
    assert.equal((box.top + box.bottom) / 2, 100);
});

test("test_the_synthetic_stage_holds_five_nodes_and_a_pane_of_the_stated_height", async () => {
    await renderViewWithSyntheticStage();
    assert.equal(document.querySelectorAll("#stage .node").length, 5);
    assert.equal(document.getElementById("timelines")!.getBoundingClientRect().height, PANE_HEIGHT_PX);
});

test("test_find_arrow_returns_the_arrow_and_read_landed_y_reads_the_landed_node", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "400");
});
