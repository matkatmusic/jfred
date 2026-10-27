// DOM tests for webapp/app-drawer.ts: the details-pane reset every route change runs first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_resetDetailsPane_hides_the_pane_and_clears_its_content_columns", async () => {
    // Scenario: a route change hides the pane, empties both columns, and resets the header.
    initWebappDom();
    const { resetDetailsPane } = await import("../webapp/app-drawer.ts");
    document.getElementById("details-left")!.append(document.createElement("span"));
    document.getElementById("details-right-body")!.append(document.createElement("span"));
    document.getElementById("details-header")!.textContent = "Raw lines";
    resetDetailsPane();
    assert.equal(document.getElementById("inspector")!.classList.contains("hidden"), true);
    assert.equal(document.getElementById("details-left")!.children.length, 0);
    assert.equal(document.getElementById("details-right-body")!.children.length, 0);
    assert.equal(document.getElementById("details-header")!.textContent, "No selection");
});
