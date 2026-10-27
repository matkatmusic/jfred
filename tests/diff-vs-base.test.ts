import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

initWebappDom();

test("test_renderDiffVsBaseView_renders_title_and_fetched_diff_for_a_cached_document", async () => {
    const { documentCache } = await import("../webapp/app-fetch.ts");
    const { renderDiffVsBaseView } = await import("../webapp/views/diff-vs-base.ts");
    documentCache.set("proj|*", { filesTouched: [] } as never);
    globalThis.fetch = (async () => new Response("@@ -1,1 +1,1 @@\n-old\n+new")) as typeof fetch;
    const container = document.createElement("div");
    await renderDiffVsBaseView(container, "proj", "src/a.ts", undefined);
    assert.equal(container.querySelector(".pane-title")!.textContent, "src/a.ts · vs base");
    assert.equal(container.querySelectorAll(".diff-text .diff-split").length, 1);
});
