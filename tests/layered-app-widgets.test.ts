// Task 207 (spec S8): the per-file widgets offset onto the shared vertical axis, with one lane
// per observing session inside. Split out of layered-app.test.ts when task 208's corroboration
// cases pushed that file over the 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayeredDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// The four distinct instants of the fixture below, resolved to their places on the one shared
// ruler. Task 239 / spec S18: the capped-gap ruler ACCUMULATES, so the server resolves every
// instant once (webapp/layer1-ruler-axis.ts) and ships the finished pixels; the page only subtracts
// two of them. The fixture therefore STATES the offsets — round numbers chosen for readability —
// rather than re-deriving the cap here, exactly as it states corroboratedInstants rather than
// re-running the S5 merge. tests/viewer_api_layered.test.ts covers the resolver's real values.
const FIXTURE_AXIS_OFFSETS_PX = {
    "2026-07-25T10:00:00.000Z": 0,
    "2026-07-25T10:02:00.000Z": 5,
    "2026-07-25T10:03:00.000Z": 7.5,
    "2026-07-25T10:05:00.000Z": 12.5,
};

// A two-file, two-session wire graph (spec S8's verification fixture). newer.py is listed FIRST
// so a widget order matching start instants can only come from sorting, never from input order:
// older.py starts 10:00 (sessions a + b), newer.py 10:05 (session b only). Every entity carries
// `corroboratedInstants` because the wire type declares it required — the server's
// describeGraphForWire always populates it, so a fixture omitting it is not a reachable state.
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

// The same fixture with older.py's 10:02 instant corroborated — the one instant session b also
// observed. Task 208 (spec S8): the dashed lines are drawn exactly at these instants, so the
// fixture states them explicitly rather than re-deriving the S5 merge in the page.
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

// The finished ruler offset an element carries, in pixels (task 239) — the one number the page
// hands CSS, which still does the placing.
function readAxisOffsetPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_file_widgets_are_offset_in_history_start_instant_order", async () => {
    // Scenario (task 207, spec S8): each file widget is offset onto the shared vertical axis by
    // the instant its history starts, so widget order follows start instant — not input order.
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
    // Scenario (task 208, spec S8): a dashed cross-lane line appears at every instant S5 marked
    // as corroborated, and nowhere else — a file with no corroboration draws none.
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
    // Scenario (task 207, spec S8): inside a widget there is one lane per session that observed
    // the file, and each lane's nodes are offset from that widget's own start instant.
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
