// Tests for filterProjectsByName and renderProjectsView (webapp/views/projects.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import { filterProjectsByName } from "../webapp/views/projects.ts";

const PROJECTS = [
    { name: "Alpha-One", jsonlFiles: [{ modifiedAt: "2026-01-02T03:04:05.000Z" }] },
    { name: "beta", jsonlFiles: [] },
];

test("test_filterProjectsByName_matches_case_insensitively_and_keeps_order", () => {
    // Scenario: the filter text matches any part of a project name, ignoring case.
    const matching = filterProjectsByName(PROJECTS, "ALPHA");
    // assert only the Alpha project remains.
    assert.deepEqual(matching.map((project) => project.name), ["Alpha-One"]);
});

test("test_filterProjectsByName_empty_filter_keeps_every_project", () => {
    // Scenario: an empty filter shows the whole list.  assert both projects remain, in order.
    assert.deepEqual(filterProjectsByName(PROJECTS, "").map((project) => project.name), ["Alpha-One", "beta"]);
});

test("test_renderProjectsView_lists_rows_and_narrows_on_input", async () => {
    // Scenario: the view lists one row per project, links each row, and narrows live as the filter changes.
    initWebappDom();
    installFetchRoutes({ "/api/projects": PROJECTS });
    const { renderProjectsView } = await import("../webapp/views/projects.ts");
    const container = document.createElement("div");
    await renderProjectsView(container);
    await waitForAsyncWork();
    // assert both rows, the count label, and the first row's link.
    assert.equal(container.querySelectorAll(".project-row").length, 2);
    assert.ok(container.textContent!.includes("2 / 2 project(s)"));
    assert.equal(container.querySelector(".project-row a")!.getAttribute("href"), "#/project/Alpha-One");
    // type into the filter: only beta stays.
    const filterInput = container.querySelector("input") as HTMLInputElement;
    filterInput.value = "bet";
    filterInput.dispatchEvent(new window.Event("input"));
    assert.equal(container.querySelectorAll(".project-row").length, 1);
    assert.ok(container.textContent!.includes("1 / 2 project(s)"));
});
