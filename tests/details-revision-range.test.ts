// Range-toggle behaviour of the Revision View: glyphs follow the selected set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { RevisionPage } from "../webapp/views/details-revision-diff.ts";

function buildStubPage(): RevisionPage {
    initWebappDom();
    const rangeToggles = [document.createElement("button"), document.createElement("button")];
    return { rangeSelected: new Set<number>(), rangeToggles } as unknown as RevisionPage;
}

test("test_refresh_range_toggle_glyphs_marks_only_selected_cards", async () => {
    const page = buildStubPage();
    const { refreshRangeToggleGlyphs } = await import("../webapp/views/details-revision-range.ts");
    page.rangeSelected.add(1);
    refreshRangeToggleGlyphs(page);
    assert.equal(page.rangeToggles[0]!.textContent, "☐");
    assert.equal(page.rangeToggles[1]!.textContent, "☑");
});
