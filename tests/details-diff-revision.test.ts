// renderRevisionDiffInDetails: a missing block renders its fallback text in the right pane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { FileChange } from "../webapp/views/timeline-types.ts";

test("test_render_revision_diff_in_details_renders_fallback_text_when_block_missing", async () => {
    initWebappDom();
    const { renderRevisionDiffInDetails } = await import("../webapp/views/details-diff-revision.ts");
    const change = { path: "a.ts", displayPath: "a.ts", changeId: undefined } as unknown as FileChange;
    await renderRevisionDiffInDetails(change, [], [], () => {});
    assert.equal(document.getElementById("details-right-label")!.textContent, "a.ts");
    assert.equal(document.getElementById("diff-mode-toggle")!.hidden, true);
    assert.ok(document.getElementById("details-right-body")!.querySelector("pre.diff-text") !== null);
});
