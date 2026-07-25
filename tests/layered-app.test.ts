// Task 205 (spec S7): the layered page skeleton — regions present, collapsing drawer, file-nav
// click scrolling to its widget, and the Changes pane hidden until a segment is selected.
// Task 206 adds the layered-graph fetch-on-load; task 212 (spec S12) the always-visible legend;
// task 207 (spec S8) the per-file widgets offset onto the shared vertical axis, lanes inside.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flushAsyncWork, setupLayeredDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

// A widget model for a file with no evidence yet — the skeleton cases care only about the name.
function describeBareFile(fileName: string): { fileName: string; lanes: []; startInstant: undefined } {
    return { fileName, lanes: [], startInstant: undefined };
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
    // Scenario: clicking a file in the drawer scrolls to its canvas widget (S7).
    // Steps:
    // render, then stub scrollIntoView on each widget to observe the call.
    setupLayeredDom();
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

// The wire graph the fetch test serves: one entity, one session timeline, no nodes.
function buildWireGraphFixture(): object {
    const timeline = { sessionFile: "/proj/a.jsonl", timeline: { nodes: [] } };
    const entity = { filename: "/w/alpha.py", sessionTimelines: [timeline] };
    return { entities: [entity], renames: [], copies: [], scriptLinks: [] };
}

test("test_boot_fetches_layered_graph_and_fills_drawer", async () => {
    // Scenario (task 206): the page fetches /api/layered-graph on load and fills the drawer —
    // session names are the distinct sessionFile basenames, file names the entity filenames.
    // Steps:
    // stub the endpoint with a one-entity wire graph and run the loader for project "p1".
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildWireGraphFixture() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    // the drawer holds session a.jsonl and file /w/alpha.py.
    assert.equal(getById("layered-session-list").children[0]?.textContent, "a.jsonl");
    assert.equal(getById("layered-file-nav").children[0]?.textContent, "/w/alpha.py");
});

test("test_boot_without_a_project_param_keeps_the_empty_skeleton", async () => {
    // Scenario (task 206): a bare page load (no ?project=) fetches nothing and renders empty.
    setupLayeredDom();
    stubFetchRoutes({});
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    // the helper's window URL carries no ?project=, so the default argument resolves to null.
    await loadLayeredGraphIntoDrawer();
    await flushAsyncWork();
    assert.equal(getById("layered-session-list").children.length, 0);
    assert.equal(getById("layered-file-nav").children.length, 0);
});

test("test_legend_sits_above_the_scrolled_timeline_area", () => {
    // Scenario (task 212, spec S12): the legend lives in the timeline area but OUTSIDE the
    // scrolled container, preceding it — so scrolling the timeline leaves the legend in view.
    setupLayeredDom();
    const legend = getById("layered-legend");
    const scroll = getById("layered-timeline-scroll");
    const timeline = getById("layered-timeline");
    assert.ok(timeline.contains(legend));
    assert.ok(timeline.contains(scroll));
    assert.ok(scroll.contains(getById("layered-canvas")));
    assert.equal(scroll.contains(legend), false);
    assert.equal(legend.nextElementSibling, scroll);
    // CSS mechanism (happy-dom loads no stylesheet, so assert the file): the scroll child is
    // the ONLY overflow container — .layered-timeline itself no longer scrolls.
    const css = readFileSync(new URL("../webapp/layered-styles.css", import.meta.url), "utf8");
    const scrollBlock = css.split(".layered-timeline-scroll {")[1]?.split("}")[0] ?? "";
    assert.ok(scrollBlock.includes("overflow"));
    const timelineBlock = css.split(".layered-timeline {")[1]?.split("}")[0] ?? "";
    assert.equal(timelineBlock.includes("overflow"), false);
});

// A two-file, two-session wire graph (spec S8's verification fixture). newer.py is listed FIRST
// so a widget order matching start instants can only come from sorting, never from input order:
// older.py starts 10:00 (sessions a + b), newer.py 10:05 (session b only).
function buildTwoFileTwoSessionGraph(): object {
    const describeBeacon = (instant: string) => ({ kind: "beacon", instant, content: "x" });
    const describeLane = (sessionFile: string, instants: string[]) =>
        ({ sessionFile, timeline: { nodes: instants.map(describeBeacon) } });
    const newer = {
        filename: "/w/newer.py",
        sessionTimelines: [describeLane("/p/b.jsonl", ["2026-07-25T10:05:00.000Z"])],
    };
    const older = {
        filename: "/w/older.py",
        sessionTimelines: [
            describeLane("/p/a.jsonl", ["2026-07-25T10:00:00.000Z", "2026-07-25T10:03:00.000Z"]),
            describeLane("/p/b.jsonl", ["2026-07-25T10:02:00.000Z"]),
        ],
    };
    return { entities: [newer, older], renames: [], copies: [], scriptLinks: [] };
}

// The canvas's file widgets, in DOM order.
function listRenderedWidgets(): HTMLElement[] {
    return [...getById("layered-canvas").querySelectorAll(".layered-file-widget")] as HTMLElement[];
}

// The raw axis milliseconds an element carries (the offset CSS scales into pixels).
function readAxisOffsetMs(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-ms"));
}

test("test_file_widgets_are_offset_in_history_start_instant_order", async () => {
    // Scenario (task 207, spec S8): each file widget is offset onto the shared vertical axis by
    // the instant its history starts, so widget order follows start instant — not input order.
    // Steps:
    // load the two-file two-session graph (entities deliberately listed newest-first).
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildTwoFileTwoSessionGraph() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    // the earlier-starting file renders first, pinned to the axis origin.
    const widgets = listRenderedWidgets();
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0]?.querySelector(".layered-file-name")?.textContent, "/w/older.py");
    assert.equal(readAxisOffsetMs(widgets[0]!), 0);
    // the later-starting file is offset by its five-minute distance from that origin.
    assert.equal(widgets[1]?.querySelector(".layered-file-name")?.textContent, "/w/newer.py");
    assert.equal(readAxisOffsetMs(widgets[1]!), 5 * 60 * 1000);
    assert.ok(readAxisOffsetMs(widgets[0]!) < readAxisOffsetMs(widgets[1]!));
});

test("test_file_widget_holds_one_lane_per_observing_session", async () => {
    // Scenario (task 207, spec S8): inside a widget there is one lane per session that observed
    // the file, and each lane's nodes are offset from that widget's own start instant.
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildTwoFileTwoSessionGraph() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    // older.py was observed by both sessions; newer.py by one.
    const [olderWidget, newerWidget] = listRenderedWidgets();
    const olderLanes = [...olderWidget!.querySelectorAll(".layered-lane")] as HTMLElement[];
    assert.deepEqual(olderLanes.map((lane) => lane.dataset.session), ["a.jsonl", "b.jsonl"]);
    assert.equal(newerWidget!.querySelectorAll(".layered-lane").length, 1);
    // lane a's two nodes sit at 0 and +3 minutes from older.py's 10:00 start.
    const laneNodes = [...olderLanes[0]!.querySelectorAll(".layered-node")] as HTMLElement[];
    assert.deepEqual(laneNodes.map(readAxisOffsetMs), [0, 3 * 60 * 1000]);
    // lane b's single node sits at +2 minutes on the SAME widget-relative axis.
    const laneBNodes = [...olderLanes[1]!.querySelectorAll(".layered-node")] as HTMLElement[];
    assert.deepEqual(laneBNodes.map(readAxisOffsetMs), [2 * 60 * 1000]);
    // the widget's span reaches its latest node so the lanes are tall enough to hold them.
    assert.equal(olderWidget!.style.getPropertyValue("--axis-span-ms"), String(3 * 60 * 1000));
});

test("test_legend_names_every_layered_node_class", () => {
    // Scenario (task 212): the legend carries the mockup's node vocabulary
    // (plans/mvp-app-mockup.html) so every rendered node class is decodable.
    setupLayeredDom();
    const legendText = getById("layered-legend").textContent ?? "";
    for (const label of ["anchor", "commit", "snapshot", "presumed user edit", "script run",
        "full-content echo", "on-disk", "ignored"]) {
        assert.ok(legendText.includes(label), `legend is missing "${label}"`);
    }
});
