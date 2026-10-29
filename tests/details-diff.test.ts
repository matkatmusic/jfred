// details-diff: the right pane renders explanatory text and hides the diff toggle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_render_text_in_details_sets_label_and_hides_toggle", async () => {
    initWebappDom();
    const { renderTextInDetails } = await import("../webapp/views/details-diff.ts");
    renderTextInDetails("label", "hello");
    assert.equal(document.getElementById("details-right-label")!.textContent, "label");
    assert.equal(document.getElementById("diff-mode-toggle")!.hidden, true);
    assert.equal(document.getElementById("details-right-body")!.textContent, "hello");
});
