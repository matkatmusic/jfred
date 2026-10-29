// DOM tests for webapp/app-router.ts: latest-wins navigation (task 138) and header visibility (task 140).

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// Boot a fresh DOM with a stubbed projects listing, then import the router under test.
async function importRouterInFreshDom(): Promise<typeof import("../webapp/app-router.ts")> {
    initWebappDom();
    installFetchRoutes({
        "/api/projects": [
            { name: "proj-a", jsonlFiles: [] },
            { name: "proj-b", jsonlFiles: [] },
        ],
    });
    return import("../webapp/app-router.ts");
}

test("test_overlapping_renderRoute_calls_render_the_projects_list_once", async () => {
    // Scenario (task 138): two renderRoute runs overlap; only the newest run's DOM may land.
    const { renderRoute } = await importRouterInFreshDom();
    // start two runs WITHOUT awaiting the first, so both are past their view clear.
    const firstRun = renderRoute();
    const secondRun = renderRoute();
    await Promise.all([firstRun, secondRun]);
    await waitForAsyncWork();
    // exactly one projects pane rendered: 2 rows (one per stubbed project), 1 filter bar.
    const view = document.getElementById("view")!;
    assert.equal(view.querySelectorAll(".project-row").length, 2);
    assert.equal(view.querySelectorAll(".filter-bar").length, 1);
});

test("test_renderRoute_hides_timeline_pane_header_on_the_projects_route", async () => {
    // Scenario (task 140): the Timeline pane header starts hidden and stays hidden on #/.
    const { renderRoute } = await importRouterInFreshDom();
    const paneHeader = document.getElementById("timeline-pane-header")!;
    // the markup ships the header hidden, so it never flashes before the first render.
    assert.equal(paneHeader.hidden, true);
    await renderRoute();
    await waitForAsyncWork();
    // still hidden on #/, and the projects view provides its own "Projects" pane title.
    assert.equal(paneHeader.hidden, true);
    const viewPaneTitles = [...document.getElementById("view")!.querySelectorAll(".pane-title")];
    assert.deepEqual(viewPaneTitles.map((title) => title.textContent), ["Projects"]);
});

test("test_renderRoute_shows_timeline_pane_header_on_a_project_route", async () => {
    // Scenario (task 140): a project route unhides the header even when the document load fails.
    const { renderRoute } = await importRouterInFreshDom();
    location.hash = "#/project/proj-a/timeline";
    await renderRoute();
    await waitForAsyncWork();
    assert.equal(document.getElementById("timeline-pane-header")!.hidden, false);
});
