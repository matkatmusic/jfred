// DOM smoke test for webapp/app-header-popovers.ts: the toolbar buttons toggle their popovers and a document click closes them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_initToolbarPopovers_paths_button_opens_popover_and_document_click_closes_it", async () => {
    // Scenario: the Paths button opens its popover and a document click closes it.
    initWebappDom();
    const { initToolbarPopovers } = await import("../webapp/app-header-popovers.ts");
    initToolbarPopovers();
    const pathsPopover = document.getElementById("paths-popover")!;
    // click the Paths button: the popover opens.
    document.getElementById("paths-btn")!.click();
    assert.equal(pathsPopover.hidden, false);
    // a plain document-level click closes it.
    document.body.click();
    assert.equal(pathsPopover.hidden, true);
});
