// Task 207 (spec S8): the per-file widgets offset onto the shared vertical axis, with one lane
// per observing session inside. Split out of layered-app.test.ts when task 208's corroboration
// cases pushed that file over the 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayeredDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

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
    return { entities: [newer, older], renames: [], copies: [], scriptLinks: [] };
}

// The canvas's file widgets, in DOM order.
function listRenderedWidgets(): HTMLElement[] {
    return [...document.querySelectorAll("#layered-canvas .layered-file-widget")] as HTMLElement[];
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
