// Task 205 (spec S7): the layered page skeleton — regions present, collapsing drawer, file-nav click scrolling to its widget, and the Changes pane hidden until a segment is selected.  Task 206 adds the layered-graph fetch-on-load; task 212 (spec S12) the always-visible legend; task 207 (spec S8) the per-file widgets offset onto the shared vertical axis, lanes inside.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayeredDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

// A widget model for a file with no evidence yet — the skeleton cases care only about the name.
function describeBareFile(fileName: string): {
    fileName: string;
    lanes: [];
    startInstant: undefined;
    corroboratedInstants: [];
} {
    return { fileName, lanes: [], startInstant: undefined, corroboratedInstants: [] };
}

test("test_layered_page_renders_all_skeleton_regions", async () => {
    // Scenario: index.html carries every S7 region; the Changes pane starts hidden.  Steps: load the layered page body into a fresh DOM.
    initLayeredDom();
    await import("../webapp/layered-app.ts");
    // drawer with its two nav sections, canvas, details, and changes are all present.
    getById("layered-drawer");
    getById("layered-session-list");
    getById("layered-file-nav");
    getById("layered-canvas");
    getById("layered-details");
    // the Changes pane exists but is hidden while nothing is selected.
    assert.equal(getById("layered-changes").hidden, true);
});

test("test_toggleLayeredDrawer_collapses_and_restores_drawer", async () => {
    // Scenario: the drawer collapse round-trips via the `collapsed` class.  Steps: load the page and toggle twice.
    initLayeredDom();
    const { toggleLayeredDrawer } = await import("../webapp/layered-app.ts");
    const drawer = getById("layered-drawer");
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), true);
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), false);
});

test("test_drawer_toggle_button_wires_to_toggle", async () => {
    // Scenario: bootLayeredApp wires the header button to the drawer toggle.  Steps: load the page and boot explicitly (module-scope boot ran against an earlier test DOM).
    initLayeredDom();
    const { bootLayeredApp } = await import("../webapp/layered-app.ts");
    bootLayeredApp();
    // clicking the button collapses the drawer.
    getById("layered-drawer-toggle").click();
    assert.equal(getById("layered-drawer").classList.contains("collapsed"), true);
});

test("test_renderLayeredDrawer_lists_sessions_files_and_widgets", async () => {
    // Scenario: rendering the drawer fills the session list, the file nav, and one placeholder widget per file in the canvas.  Steps: render two sessions and two files.
    initLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer(["a.jsonl", "b.jsonl"], ["alpha.py", "beta.py"].map(describeBareFile));
    // two session items, two file-nav items, two canvas widgets carrying the file names.
    assert.equal(getById("layered-session-list").children.length, 2);
    assert.equal(getById("layered-file-nav").children.length, 2);
    const widgets = getById("layered-canvas").querySelectorAll(".layered-file-widget");
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0]?.textContent, "alpha.py");
    assert.equal(widgets[1]?.textContent, "beta.py");
});

test("test_file_nav_click_scrolls_to_its_widget", async () => {
    // Scenario: clicking a file in the drawer scrolls to its canvas widget (S7).  Steps: render, then stub scrollIntoView on each widget to observe the call.
    initLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer([], ["alpha.py", "beta.py"].map(describeBareFile));
    let scrolledTo = "";
    for (const widget of getById("layered-canvas").querySelectorAll(".layered-file-widget")) {
        (widget as HTMLElement).scrollIntoView = () => { scrolledTo = widget.id; };
    }
    // clicking the SECOND nav item scrolls to the second widget.
    (getById("layered-file-nav").children[1] as HTMLElement).click();
    assert.equal(scrolledTo, "layered-file-widget-1");
});

test("test_revealChangesPane_toggles_hidden_with_selection", async () => {
    // Scenario: the Changes pane shows only while a segment is selected.  Steps: reveal with a selection, then hide without one.
    initLayeredDom();
    const { revealChangesPane } = await import("../webapp/layered-app.ts");
    revealChangesPane(true);
    assert.equal(getById("layered-changes").hidden, false);
    revealChangesPane(false);
    assert.equal(getById("layered-changes").hidden, true);
});

// The wire graph the fetch test serves: one entity, one session timeline, no nodes. No nodes means no instants, so the shared ruler (task 239) is legitimately empty — the widget pins to origin.
function buildWireGraphFixture(): object {
    const timeline = { sessionFile: "/proj/a.jsonl", timeline: { nodes: [] } };
    const entity = { filename: "/w/alpha.py", sessionTimelines: [timeline], corroboratedInstants: [] };
    return { entities: [entity], renames: [], copies: [], scriptLinks: [], axisOffsetsPx: {} };
}

test("test_boot_fetches_layered_graph_and_fills_drawer", async () => {
    // Scenario (task 206): the page fetches /api/layered-graph on load and fills the drawer — session names are the distinct sessionFile basenames, file names the entity filenames.  Steps: stub the endpoint with a one-entity wire graph and run the loader for project "p1".
    initLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildWireGraphFixture() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await waitForAsyncWork();
    // the drawer holds session a.jsonl and file /w/alpha.py.
    assert.equal(getById("layered-session-list").children[0]?.textContent, "a.jsonl");
    assert.equal(getById("layered-file-nav").children[0]?.textContent, "/w/alpha.py");
});

test("test_boot_without_a_project_param_keeps_the_empty_skeleton", async () => {
    // Scenario (task 206): a bare page load (no ?project=) fetches nothing and renders empty.
    initLayeredDom();
    stubFetchRoutes({});
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    // the helper's window URL carries no ?project=, so the default argument resolves to null.
    await loadLayeredGraphIntoDrawer();
    await waitForAsyncWork();
    assert.equal(getById("layered-session-list").children.length, 0);
    assert.equal(getById("layered-file-nav").children.length, 0);
});
