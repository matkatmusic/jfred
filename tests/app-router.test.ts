// DOM tests for webapp/app-router.ts: the latest-wins navigation guard (task 138) and the timeline-pane-header route visibility (task 140), run against the real index.html markup (webapp-dom-test-helpers.ts installs the globals the webapp import chain expects).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// Boot a fresh DOM with a stubbed projects listing and import the router under test. The dynamic import keeps every webapp module load AFTER the happy-dom globals exist.
async function importRouterInFreshDom(): Promise<typeof import("../webapp/app-router.ts")> {
    setupWebappDom();
    stubFetchRoutes({
        "/api/projects": [
            { name: "proj-a", jsonlFiles: [] },
            { name: "proj-b", jsonlFiles: [] },
        ],
    });
    return import("../webapp/app-router.ts");
}

test("test_overlapping_renderRoute_calls_render_the_projects_list_once", async () => {
    // Scenario (task 138): two renderRoute runs overlap (the folder switch fires hashchange AND an explicit call); only the newest run's DOM may land — one filter bar, one row per project.
    const { renderRoute } = await importRouterInFreshDom();
    // start two runs WITHOUT awaiting the first, so both are past their view clear.
    const firstRun = renderRoute();
    const secondRun = renderRoute();
    await Promise.all([firstRun, secondRun]);
    await flushAsyncWork();
    // exactly one projects pane rendered: 2 rows (one per stubbed project), 1 filter bar.
    const view = document.getElementById("view")!;
    assert.equal(view.querySelectorAll(".project-row").length, 2);
    assert.equal(view.querySelectorAll(".filter-bar").length, 1);
});

test("test_renderRoute_hides_timeline_pane_header_on_the_projects_route", async () => {
    // Scenario (task 140): the Timeline pane header is timeline chrome — it starts hidden in the markup and stays hidden on #/, while the projects view brings its own pane title.
    const { renderRoute } = await importRouterInFreshDom();
    const paneHeader = document.getElementById("timeline-pane-header")!;
    // the markup ships the header hidden, so it never flashes before the first render.
    assert.equal(paneHeader.hidden, true);
    await renderRoute();
    await flushAsyncWork();
    // still hidden on #/, and the projects view provides its own "Projects" pane title.
    assert.equal(paneHeader.hidden, true);
    const viewPaneTitles = [...document.getElementById("view")!.querySelectorAll(".pane-title")];
    assert.deepEqual(viewPaneTitles.map((title) => title.textContent), ["Projects"]);
});

test("test_renderRoute_shows_timeline_pane_header_on_a_project_route", async () => {
    // Scenario (task 140): a project route is a timeline route — the header unhides even while the document load itself fails (the stub answers 404; renderRoute's catch shows the error).
    const { renderRoute } = await importRouterInFreshDom();
    location.hash = "#/project/proj-a/timeline";
    await renderRoute();
    await flushAsyncWork();
    assert.equal(document.getElementById("timeline-pane-header")!.hidden, false);
});
