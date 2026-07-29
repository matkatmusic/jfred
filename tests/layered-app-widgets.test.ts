// Task 207/208 (spec S8): per-file widgets on a shared axis, split out when layered-app.test.ts hit the 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayeredDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// Task 239/S18: fixture states finished ruler offsets directly instead of re-deriving the cap; see viewer_api_layered.test.ts.
const FIXTURE_AXIS_OFFSETS_PX = {
    "2026-07-25T10:00:00.000Z": 0,
    "2026-07-25T10:02:00.000Z": 5,
    "2026-07-25T10:03:00.000Z": 7.5,
    "2026-07-25T10:05:00.000Z": 12.5,
};

// Spec S8 fixture: newer.py listed first so widget order can only come from sorting, not input order.
function buildTwoFileTwoSessionGraph(): object {
    const describeBeacon = (instant: string) => ({ kind: "beacon", instant, content: "x" });
    const describeLane = (sessionFile: string, instants: string[]) =>
        ({ sessionFile, timeline: { nodes: instants.map(describeBeacon) } });
    const newer = {
        filename: "/w/newer.py",
        sessionTimelines: [describeLane("/p/b.jsonl", ["2026-07-25T10:05:00.000Z"])],
        corroboratedInstants: [],
    };
    const older = {
        filename: "/w/older.py",
        sessionTimelines: [
            describeLane("/p/a.jsonl", ["2026-07-25T10:00:00.000Z", "2026-07-25T10:03:00.000Z"]),
            describeLane("/p/b.jsonl", ["2026-07-25T10:02:00.000Z"]),
        ],
        corroboratedInstants: [],
    };
    return { entities: [newer, older], renames: [], copies: [], scriptLinks: [], axisOffsetsPx: FIXTURE_AXIS_OFFSETS_PX };
}

// Task 208 (spec S8): fixture states the corroborated instant explicitly instead of re-deriving the S5 merge.
function buildCorroboratedGraph(): object {
    const graph = buildTwoFileTwoSessionGraph() as { entities: { filename: string; corroboratedInstants: string[] }[] };
    const older = graph.entities.find((entity) => entity.filename === "/w/older.py");
    older!.corroboratedInstants = ["2026-07-25T10:02:00.000Z"];
    return graph;
}

// The canvas's file widgets, in DOM order.
function listRenderedWidgets(): HTMLElement[] {
    return [...document.querySelectorAll("#layered-canvas .layered-file-widget")] as HTMLElement[];
}

// Task 239: the finished ruler offset in pixels that the page hands to CSS for placement.
function readAxisOffsetPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_file_widgets_are_offset_in_history_start_instant_order", async () => {
    // Task 207 (spec S8): widgets offset onto the shared axis by start instant, so order follows start instant.
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildTwoFileTwoSessionGraph() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    const widgets = listRenderedWidgets();
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0]?.querySelector(".layered-file-name")?.textContent, "/w/older.py");
    assert.equal(readAxisOffsetPx(widgets[0]!), 0);
    assert.equal(widgets[1]?.querySelector(".layered-file-name")?.textContent, "/w/newer.py");
    assert.equal(readAxisOffsetPx(widgets[1]!), 12.5);
    assert.ok(readAxisOffsetPx(widgets[0]!) < readAxisOffsetPx(widgets[1]!));
});

test("test_dashed_lines_are_drawn_exactly_at_corroborated_instants", async () => {
    // Task 208 (spec S8): dashed lines appear only at instants S5 marked corroborated, nowhere else.
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildCorroboratedGraph() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    const [olderWidget, newerWidget] = listRenderedWidgets();
    const lines = [...olderWidget!.querySelectorAll(".layered-corroboration")] as HTMLElement[];
    assert.deepEqual(lines.map(readAxisOffsetPx), [5]);
    assert.equal(lines[0]!.parentElement?.className, "layered-lanes");
    assert.equal(newerWidget!.querySelectorAll(".layered-corroboration").length, 0);
});

test("test_file_widget_holds_one_lane_per_observing_session", async () => {
    // Task 207 (spec S8): one lane per observing session inside a widget, nodes offset from the widget's start instant.
    setupLayeredDom();
    stubFetchRoutes({ "/api/layered-graph": buildTwoFileTwoSessionGraph() });
    const { loadLayeredGraphIntoDrawer } = await import("../webapp/layered-app.ts");
    await loadLayeredGraphIntoDrawer("p1");
    await flushAsyncWork();
    const [olderWidget, newerWidget] = listRenderedWidgets();
    const olderLanes = [...olderWidget!.querySelectorAll(".layered-lane")] as HTMLElement[];
    assert.deepEqual(olderLanes.map((lane) => lane.dataset.session), ["a.jsonl", "b.jsonl"]);
    assert.equal(newerWidget!.querySelectorAll(".layered-lane").length, 1);
    const laneNodes = [...olderLanes[0]!.querySelectorAll(".layered-node")] as HTMLElement[];
    assert.deepEqual(laneNodes.map(readAxisOffsetPx), [0, 7.5]);
    const laneBNodes = [...olderLanes[1]!.querySelectorAll(".layered-node")] as HTMLElement[];
    assert.deepEqual(laneBNodes.map(readAxisOffsetPx), [5]);
    assert.equal(olderWidget!.style.getPropertyValue("--axis-span-px"), "7.5");
});
