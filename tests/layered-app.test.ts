// Layered page skeleton: regions, collapsing drawer, file-nav scrolling, hidden Changes pane, graph fetch on load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayeredDom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

// A widget model for a file with no evidence yet.
function describeBareFile(fileName: string): {
    fileName: string;
    lanes: [];
    startInstant: undefined;
    corroboratedInstants: [];
} {
    return { fileName, lanes: [], startInstant: undefined, corroboratedInstants: [] };
}

test("test_layered_page_renders_all_skeleton_regions", async () => {
    // Scenario: index.html carries every region and the Changes pane starts hidden.
    initLayeredDom();
    await import("../webapp/layered-app.ts");
    // Every region is present.
    getById("layered-drawer");
    getById("layered-session-list");
    getById("layered-file-nav");
    getById("layered-canvas");
    getById("layered-details");
    // The Changes pane is hidden while nothing is selected.
    assert.equal(getById("layered-changes").hidden, true);
});

test("test_toggleLayeredDrawer_collapses_and_restores_drawer", async () => {
    // Scenario: toggling the drawer twice adds then removes the `collapsed` class.
    initLayeredDom();
    const { toggleLayeredDrawer } = await import("../webapp/layered-app.ts");
    const drawer = getById("layered-drawer");
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), true);
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), false);
});

test("test_drawer_toggle_button_wires_to_toggle", async () => {
    // Scenario: launchLayeredApp wires the header button to the drawer toggle.
    initLayeredDom();
    const { launchLayeredApp } = await import("../webapp/layered-app.ts");
    launchLayeredApp();
    // Clicking the button collapses the drawer.
    getById("layered-drawer-toggle").click();
    assert.equal(getById("layered-drawer").classList.contains("collapsed"), true);
});

test("test_renderLayeredDrawer_lists_sessions_files_and_widgets", async () => {
    // Scenario: rendering fills the session list, the file nav, and one widget per file.
    initLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer(["a.jsonl", "b.jsonl"], ["alpha.py", "beta.py"].map(describeBareFile));
    // Two session items, two file-nav items, two canvas widgets.
    assert.equal(getById("layered-session-list").children.length, 2);
    assert.equal(getById("layered-file-nav").children.length, 2);
    const widgets = getById("layered-canvas").querySelectorAll(".layered-file-widget");
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0]?.textContent, "alpha.py");
    assert.equal(widgets[1]?.textContent, "beta.py");
});

test("test_file_nav_click_scrolls_to_its_widget", async () => {
    // Scenario: clicking a file in the drawer scrolls to its canvas widget.
    initLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer([], ["alpha.py", "beta.py"].map(describeBareFile));
    let scrolledTo = "";
    for (const widget of getById("layered-canvas").querySelectorAll(".layered-file-widget")) {
        (widget as HTMLElement).scrollIntoView = () => { scrolledTo = widget.id; };
    }
    // Clicking the second nav item scrolls to the second widget.
    (getById("layered-file-nav").children[1] as HTMLElement).click();
    assert.equal(scrolledTo, "layered-file-widget-1");
});

test("test_setChangesPaneVisible_toggles_hidden_with_selection", async () => {
    // Scenario: the Changes pane shows only while a segment is selected.
    initLayeredDom();
    const { setChangesPaneVisible } = await import("../webapp/layered-app.ts");
    setChangesPaneVisible(true);
    assert.equal(getById("layered-changes").hidden, false);
    setChangesPaneVisible(false);
    assert.equal(getById("layered-changes").hidden, true);
});

// The wire graph the fetch test serves: one entity, one timeline, no nodes.
function buildWireGraphFixture(): object {
    const timeline = { sessionFile: "/proj/a.jsonl", timeline: { nodes: [] } };
    const entity = { filename: "/w/alpha.py", sessionTimelines: [timeline], corroboratedInstants: [] };
    return { entities: [entity], renames: [], copies: [], scriptLinks: [], axisOffsetsPx: {} };
}

test("test_boot_fetches_layered_graph_and_fills_drawer", async () => {
    // Scenario: the page fetches /api/layered-graph on load and fills the drawer.
    initLayeredDom();
    installFetchRoutes({ "/api/layered-graph": buildWireGraphFixture() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await waitForAsyncWork();
    // The drawer holds session a.jsonl and file /w/alpha.py.
    assert.equal(getById("layered-session-list").children[0]?.textContent, "a.jsonl");
    assert.equal(getById("layered-file-nav").children[0]?.textContent, "/w/alpha.py");
});

test("test_boot_without_a_project_param_keeps_the_empty_skeleton", async () => {
    // Scenario: a bare page load with no ?project= fetches nothing and renders empty.
    initLayeredDom();
    installFetchRoutes({});
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    // The window URL has no ?project=, so the default argument is null.
    await loadLayeredGraphIntoDrawer();
    await waitForAsyncWork();
    assert.equal(getById("layered-session-list").children.length, 0);
    assert.equal(getById("layered-file-nav").children.length, 0);
});
