// The show row's kind-jump arrows for empty kinds, hidden kinds, and branch dots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";
import {
    buildNode, findArrow, readLandedY, refreshKindJumpArrows, renderViewWithSyntheticStage,
} from "./layer1-kind-jump-helpers.ts";

function buildBranchDot(centerY: number): HTMLElement {
    const dot = buildNode("", centerY);
    dot.className = "bnode";
    return dot;
}

test("test_the_arrows_are_disabled_for_a_kind_with_no_nodes_and_for_a_hidden_kind", async () => {
    await renderViewWithSyntheticStage();
    for (const direction of ["previous", "next"]) {
        assert.equal(findArrow("disk", direction).disabled, true);
        assert.equal(findArrow("script-run", direction).disabled, true);
        assert.equal(findArrow("snapshot", direction).disabled, false);
    }
    const box = document.querySelector<HTMLInputElement>("#show-row input[data-kind=snapshot]")!;
    box.checked = false;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    for (const direction of ["previous", "next"]) {
        assert.equal(findArrow("snapshot", direction).disabled, true);
    }
});

test("test_the_branch_arrows_step_between_branch_dots_once_the_branch_box_is_ticked", async () => {
    await renderViewWithSyntheticStage();
    stubStreamRoute("/api/layer1-branches", [{ pairs: [] }]);
    const box = document.querySelector<HTMLInputElement>("#show-row input[data-kind=branch]")!;
    box.checked = true;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitForAsyncWork();
    document.getElementById("stage")!.replaceChildren(buildNode("n-commit", 100), buildBranchDot(400), buildBranchDot(700));
    refreshKindJumpArrows();
    assert.equal(findArrow("branch", "previous").disabled, true);
    assert.equal(findArrow("branch", "next").disabled, false);
    findArrow("branch", "next").click();
    assert.equal(readLandedY(), "400");
});
