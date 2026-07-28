// DOM smoke tests for webapp/app-paths-sources.ts (task 177): the Paths popover's per-project
// Sources list — rows prefill from the merged entry, "Add source" appends an empty row, a row's
// remove button deletes it, and Apply posts the entered list (omitting `sources` entirely when
// no row qualifies).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

// Wrap the current stubbed fetch with a recorder so a test can inspect POST bodies while the
// canned routes keep answering (app-header.test.ts's recordFetchCalls pattern).
function recordFetchCalls(): { url: string; init: RequestInit | undefined }[] {
    const recordedCalls: { url: string; init: RequestInit | undefined }[] = [];
    const delegate = globalThis.fetch;
    Object.assign(globalThis, {
        fetch: (url: unknown, init?: RequestInit) => {
            recordedCalls.push({ url: String(url), init });
            return delegate(String(url), init);
        },
    });
    return recordedCalls;
}

test("test_refresh_prefills_source_rows_from_merged_entry", async () => {
    // Scenario (task 177): GET /api/project-paths returns an entry with two sources (one with
    // all three fields, one with only projectsDir) — refreshing the section renders one
    // .source-row per entry, prefilled from its fields.
    setupWebappDom();
    stubFetchRoutes({
        "/api/project-paths": {
            repo: "/repos/p",
            sources: [
                { projectsDir: "/roots/alpha/projects", fileHistoryDir: "/roots/alpha/fh", root: "/roots/alpha" },
                { projectsDir: "/roots/beta/projects" },
            ],
        },
    });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    const rows = [...getRequiredElementById("project-sources-list").querySelectorAll(".source-row")];
    assert.equal(rows.length, 2);
    assert.equal((rows[0]!.querySelector(".source-projects-dir") as HTMLInputElement).value, "/roots/alpha/projects");
    assert.equal((rows[0]!.querySelector(".source-file-history-dir") as HTMLInputElement).value, "/roots/alpha/fh");
    assert.equal((rows[0]!.querySelector(".source-root") as HTMLInputElement).value, "/roots/alpha");
    assert.equal((rows[1]!.querySelector(".source-projects-dir") as HTMLInputElement).value, "/roots/beta/projects");
    assert.equal((rows[1]!.querySelector(".source-file-history-dir") as HTMLInputElement).value, "");
    assert.equal((rows[1]!.querySelector(".source-root") as HTMLInputElement).value, "");
});

test("test_add_button_appends_an_empty_source_row", async () => {
    // Scenario (task 177): with zero sources, clicking "Add source" appends one empty row.
    setupWebappDom();
    stubFetchRoutes({ "/api/project-paths": { repo: "/repos/p" } });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    assert.equal(getRequiredElementById("project-sources-list").querySelectorAll(".source-row").length, 0);
    getRequiredElementById("project-sources-add").click();
    const rows = [...getRequiredElementById("project-sources-list").querySelectorAll(".source-row")];
    assert.equal(rows.length, 1);
    assert.equal((rows[0]!.querySelector(".source-projects-dir") as HTMLInputElement).value, "");
});

test("test_remove_button_deletes_its_row", async () => {
    // Scenario (task 177): with two rows rendered, clicking the first row's remove button
    // deletes only that row — one row remains, and it is the second entry.
    setupWebappDom();
    stubFetchRoutes({
        "/api/project-paths": {
            sources: [{ projectsDir: "/roots/alpha/projects" }, { projectsDir: "/roots/beta/projects" }],
        },
    });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    const rowsBefore = [...getRequiredElementById("project-sources-list").querySelectorAll(".source-row")];
    assert.equal(rowsBefore.length, 2);
    (rowsBefore[0]!.querySelector(".source-remove") as HTMLElement).click();
    const rowsAfter = [...getRequiredElementById("project-sources-list").querySelectorAll(".source-row")];
    assert.equal(rowsAfter.length, 1);
    assert.equal((rowsAfter[0]!.querySelector(".source-projects-dir") as HTMLInputElement).value, "/roots/beta/projects");
});

test("test_apply_posts_entered_sources_list", async () => {
    // Scenario (task 177): refreshing with zero sources, adding two rows, and filling their
    // fields (row 1: projectsDir + root; row 2: projectsDir only) — clicking Apply posts the
    // entered list, with row 2 omitting its empty optional keys entirely.
    setupWebappDom();
    stubFetchRoutes({ "/api/project-paths": {} });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    const addButton = getRequiredElementById("project-sources-add");
    addButton.click();
    addButton.click();
    const rows = [...getRequiredElementById("project-sources-list").querySelectorAll(".source-row")];
    assert.equal(rows.length, 2);
    (rows[0]!.querySelector(".source-projects-dir") as HTMLInputElement).value = "/roots/alpha/projects";
    (rows[0]!.querySelector(".source-root") as HTMLInputElement).value = "/roots/alpha";
    (rows[1]!.querySelector(".source-projects-dir") as HTMLInputElement).value = "/roots/beta/projects";
    const recordedCalls = recordFetchCalls();
    getRequiredElementById("project-paths-apply").click();
    await flushAsyncWork();
    const pathsPost = recordedCalls.find((call) => call.url.includes("/api/project-paths") && call.init?.method === "POST");
    assert.ok(pathsPost !== undefined, "a POST to /api/project-paths was recorded");
    const body = JSON.parse(String(pathsPost!.init!.body)) as { entry: { sources?: unknown } };
    assert.deepEqual(body.entry.sources, [
        { projectsDir: "/roots/alpha/projects", root: "/roots/alpha" },
        { projectsDir: "/roots/beta/projects" },
    ]);
});

test("test_apply_with_no_source_rows_omits_sources_field", async () => {
    // Scenario (task 177): with no rows added, the POSTed entry has no `sources` key at all —
    // legacy entries stay legacy.
    setupWebappDom();
    stubFetchRoutes({ "/api/project-paths": {} });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    const recordedCalls = recordFetchCalls();
    getRequiredElementById("project-paths-apply").click();
    await flushAsyncWork();
    const pathsPost = recordedCalls.find((call) => call.url.includes("/api/project-paths") && call.init?.method === "POST");
    assert.ok(pathsPost !== undefined, "a POST to /api/project-paths was recorded");
    const body = JSON.parse(String(pathsPost!.init!.body)) as { entry: Record<string, unknown> };
    assert.equal("sources" in body.entry, false);
});
