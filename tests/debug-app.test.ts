// Task 183: the per-file debug viewer's page skeleton — file selection listing deep-link
// anchors, a status line, and boot behavior for the three URL shapes (no project, project
// only, project + deep-linked file). Ladder RENDERING is task 184 — the deep-linked boot only
// reports the fetched revision count here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupDebugDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

test("test_debug_page_renders_file_list_and_status_regions", async () => {
    // Scenario: debug.html carries the skeleton regions.
    // Steps:
    // load the debug page body into a fresh DOM (no project param — boot stays fetch-free).
    setupDebugDom();
    await import("../webapp/debug-app.ts");
    // the status line and the file-selection list are both present.
    getById("debug-status");
    getById("debug-file-list");
});

test("test_renderDebugFileList_builds_deep_link_anchors", async () => {
    // Scenario: each listed file is an anchor deep-linking to this page with project + file params.
    // Steps:
    // render one file into the list.
    setupDebugDom();
    const { renderDebugFileList } = await import("../webapp/debug-app.ts");
    renderDebugFileList("proj", ["/w/alpha.py"]);
    // the entry is an <a> whose href round-trips the deep link and whose text names the path.
    const anchor = getById("debug-file-list").querySelector("a");
    assert.ok(anchor, "no anchor rendered");
    assert.equal(anchor?.getAttribute("href"), "/app/debug.html?project=proj&file=%2Fw%2Falpha.py");
    assert.equal(anchor?.textContent, "/w/alpha.py");
});

test("test_debug_boot_without_project_shows_guidance", async () => {
    // Scenario: with no ?project the page explains how to open it instead of fetching.
    // Steps:
    // boot over a paramless URL.
    setupDebugDom();
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // the status names the missing project selection.
    assert.match(getById("debug-status").textContent ?? "", /no project selected/);
});

test("test_debug_boot_with_project_fetches_and_renders_file_list", async () => {
    // Scenario: ?project=proj fetches the ladder file list and renders the deep-link anchors.
    // Steps:
    // boot over a project URL with the list response stubbed.
    setupDebugDom("?project=proj");
    stubFetchRoutes({ "/api/file-ladder": { files: ["/w/alpha.py"] } });
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // one anchor per listed file appears, and the status invites a pick.
    assert.equal(getById("debug-file-list").querySelectorAll("a").length, 1);
    assert.match(getById("debug-status").textContent ?? "", /select a file/);
});

test("test_debug_boot_with_deep_linked_file_shows_revision_count", async () => {
    // Scenario: ?project&file fetches that file's ladder and reports its revision count
    // (rendering the ladder itself is task 184).
    // Steps:
    // boot over a deep-linked URL with the ladder response stubbed.
    setupDebugDom("?project=proj&file=%2Fw%2Falpha.py");
    stubFetchRoutes({ "/api/file-ladder": { target: "/w/alpha.py", revisions: [{}, {}] } });
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // the status names the file and its 2 fetched revisions.
    assert.match(getById("debug-status").textContent ?? "", /alpha\.py/);
    assert.match(getById("debug-status").textContent ?? "", /2 revision/);
});

test("test_debug_boot_with_failed_fetch_reports_the_failure", async () => {
    // Scenario: a failed list fetch surfaces in the status line instead of a silent empty page.
    // Steps:
    // boot over a project URL with NO stub for the route (the stub answers 404).
    setupDebugDom("?project=proj");
    stubFetchRoutes({});
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // the status carries the failure.
    assert.match(getById("debug-status").textContent ?? "", /failed/);
});
