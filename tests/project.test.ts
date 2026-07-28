// DOM test for webapp/views/project.ts (task 185): the File Nav drawer's JSONL list lives in its own scroll container capped at half the column, so a project with many JSONLs leaves the files-touched tree visible below it. (The DOM-free view-model tests for this module live in tests/viewer-project-views.test.ts.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const MANY_JSONLS = Array.from({ length: 40 }, (_, index) => ({
    fileName: `session-${String(index).padStart(2, "0")}.jsonl`,
    sizeBytes: 1024,
    modifiedAt: "2026-07-22T10:00:00.000Z",
}));

test("test_drawer_caps_jsonl_list_and_keeps_file_tree_outside_it", async () => {
    setupWebappDom();
    stubFetchRoutes({ "/api/projects": [{ name: "proj-185", jsonlFiles: MANY_JSONLS }] });
    const { documentCache } = await import("../webapp/app-fetch.ts");
    documentCache.set("proj-185|*", {
        filesTouched: [{ target: "/ws/parser.py" }, { target: "/ws/tests/test_parser.py" }],
        messages: [],
    } as never);
    const { renderProjectDrawer } = await import("../webapp/views/project.ts");
    const drawer = document.getElementById("drawer")!;
    await renderProjectDrawer(drawer as never, "proj-185", {});

    // Every JSONL link renders inside the capped .drawer-jsonl-list container — none as a direct drawer child, or the CSS height cap would not bound them.
    const jsonlList = drawer.querySelector(".drawer-jsonl-list");
    assert.ok(jsonlList !== null, "the JSONL list container exists");
    assert.equal(jsonlList!.querySelectorAll("a.drawer-item").length, MANY_JSONLS.length);

    // The files-touched tree renders OUTSIDE the capped container, so it stays visible no matter how many JSONLs the project has.
    const treeFiles = drawer.querySelectorAll(".drawer-file");
    assert.equal(treeFiles.length, 2);
    for (const treeFile of treeFiles) {
        assert.ok(!jsonlList!.contains(treeFile), "tree files are not inside the JSONL list");
    }
});

test("test_stylesheet_caps_jsonl_list_at_half_the_column_and_scrolls_it", () => {
    // happy-dom computes no layout, so the 50% cap is asserted against the stylesheet rule the container class carries.
    const styles = readFileSync(new URL("../webapp/styles.css", import.meta.url), "utf8");
    const rule = styles.match(/\.drawer-jsonl-list\s*\{([^}]*)\}/);
    assert.ok(rule !== null, ".drawer-jsonl-list has a stylesheet rule");
    assert.match(rule![1]!, /max-height:\s*50%/);
    assert.match(rule![1]!, /overflow-y:\s*auto/);
});
