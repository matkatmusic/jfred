import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

// The module reads localStorage when imported, so the DOM must exist first.
initWebappDom();

test("test_renderDiffText_defaults_to_split_grid_and_toggles_to_inline", async () => {
    const { renderDiffText } = await import("../webapp/views/diff-text-render.ts");
    const pane = document.createElement("div");
    renderDiffText(pane, "@@ -1,1 +1,1 @@\n-old\n+new");
    assert.equal(pane.querySelectorAll(".diff-split").length, 1);
    assert.equal(pane.querySelectorAll(".diff-inline").length, 0);
    pane.querySelector<HTMLElement>(".row-btn")!.click();
    assert.equal(pane.querySelectorAll(".diff-inline").length, 1);
    assert.equal(pane.querySelectorAll(".diff-split").length, 0);
    assert.equal(localStorage.getItem("diffDisplayMode"), "inline");
});
