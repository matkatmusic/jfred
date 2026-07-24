// Task 205 (spec S7): the layered page skeleton — regions present, collapsing drawer, file-nav
// click scrolling to its widget, and the Changes pane hidden until a segment is selected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayeredDom } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

test("test_layered_page_renders_all_skeleton_regions", async () => {
    // Scenario: index.html carries every S7 region; the Changes pane starts hidden.
    // Steps:
    // load the layered page body into a fresh DOM.
    setupLayeredDom();
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
    // Scenario: the drawer collapse round-trips via the `collapsed` class.
    // Steps:
    // load the page and toggle twice.
    setupLayeredDom();
    const { toggleLayeredDrawer } = await import("../webapp/layered-app.ts");
    const drawer = getById("layered-drawer");
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), true);
    toggleLayeredDrawer();
    assert.equal(drawer.classList.contains("collapsed"), false);
});

test("test_drawer_toggle_button_wires_to_toggle", async () => {
    // Scenario: bootLayeredApp wires the header button to the drawer toggle.
    // Steps:
    // load the page and boot explicitly (module-scope boot ran against an earlier test DOM).
    setupLayeredDom();
    const { bootLayeredApp } = await import("../webapp/layered-app.ts");
    bootLayeredApp();
    // clicking the button collapses the drawer.
    getById("layered-drawer-toggle").click();
    assert.equal(getById("layered-drawer").classList.contains("collapsed"), true);
});

test("test_renderLayeredDrawer_lists_sessions_files_and_widgets", async () => {
    // Scenario: rendering the drawer fills the session list, the file nav, and one placeholder
    // widget per file in the canvas.
    // Steps:
    // render two sessions and two files.
    setupLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer(["a.jsonl", "b.jsonl"], ["alpha.py", "beta.py"]);
    // two session items, two file-nav items, two canvas widgets carrying the file names.
    assert.equal(getById("layered-session-list").children.length, 2);
    assert.equal(getById("layered-file-nav").children.length, 2);
    const widgets = getById("layered-canvas").querySelectorAll(".layered-file-widget");
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0]?.textContent, "alpha.py");
    assert.equal(widgets[1]?.textContent, "beta.py");
});

test("test_file_nav_click_scrolls_to_its_widget", async () => {
    // Scenario: clicking a file in the drawer scrolls to its canvas widget (S7).
    // Steps:
    // render, then stub scrollIntoView on each widget to observe the call.
    setupLayeredDom();
    const { renderLayeredDrawer } = await import("../webapp/layered-app.ts");
    renderLayeredDrawer([], ["alpha.py", "beta.py"]);
    let scrolledTo = "";
    for (const widget of getById("layered-canvas").querySelectorAll(".layered-file-widget")) {
        (widget as HTMLElement).scrollIntoView = () => { scrolledTo = widget.id; };
    }
    // clicking the SECOND nav item scrolls to the second widget.
    (getById("layered-file-nav").children[1] as HTMLElement).click();
    assert.equal(scrolledTo, "layered-file-widget-1");
});

test("test_revealChangesPane_toggles_hidden_with_selection", async () => {
    // Scenario: the Changes pane shows only while a segment is selected.
    // Steps:
    // reveal with a selection, then hide without one.
    setupLayeredDom();
    const { revealChangesPane } = await import("../webapp/layered-app.ts");
    revealChangesPane(true);
    assert.equal(getById("layered-changes").hidden, false);
    revealChangesPane(false);
    assert.equal(getById("layered-changes").hidden, true);
});
