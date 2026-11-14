// Task 907: with session ticks the column places dots by row and line; the button asks the page to relayout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildDot, buildTicks, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";
import { LANE_STEP_PX } from "../webapp/layer1-components/session-column/layer1-session-lanes.ts";
const { registerSessionRelayout, renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const INSTANTS_PATHNAME = "/api/layer1-session-dot-instants";
const DOT_SIZE_PX = 14;
const START_MS = Date.parse("2026-06-01T00:00:00Z");

// Row i is at 100 * i; rows from 4 down are moved by shiftPx; dotBlockPx is set only for a session layout.
function buildRowTicks(shiftPx: number, hasDotBlocks: boolean): WireRulerTick[] {
    const ticks: WireRulerTick[] = [];
    for (let index = 0; index < 8; index++) {
        const tick: WireRulerTick = { instant: new Date(START_MS + index * 3600_000).toISOString(), axisPx: index * 100 + (index >= 4 ? shiftPx : 0), eventCount: 1 };
        if (hasDotBlocks) {
            tick.dotBlockPx = 3 * DOT_SIZE_PX;
        }
        ticks.push(tick);
    }
    return ticks;
}

function buildDotAt(id: string, sessionId: string, rowIndex: number, minutes: number): WireAnnotation {
    return buildDot(id, new Date(START_MS + rowIndex * 3600_000 + minutes * 60_000).toISOString(), sessionId);
}

// Sessions s1 and s2 each have three dots in row 1; s1 has one more at the start of row 3.
function buildSessionDots(): WireAnnotation[] {
    return [buildDotAt("a1", "s1", 1, 10), buildDotAt("a2", "s1", 1, 20), buildDotAt("a3", "s1", 1, 30), buildDotAt("b1", "s2", 1, 10), buildDotAt("b2", "s2", 1, 20), buildDotAt("b3", "s2", 1, 30), buildDotAt("a4", "s1", 3, 0)];
}

function readDrawnNode(recordId: string): HTMLElement {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .anode[data-record-id="${recordId}"]`)!;
}

function readAxisPx(recordId: string): number {
    return Number(readDrawnNode(recordId).style.getPropertyValue("--axis-px"));
}

function readLaneX(recordId: string): string {
    return readDrawnNode(recordId).style.getPropertyValue("--lane-x");
}

function readDotLeftPx(node: HTMLElement): number {
    // task 912: session layout steps --stack by LANE_STEP_PX
    // return parseFloat(node.style.getPropertyValue("--lane-x")) + Number(node.style.getPropertyValue("--stack")) * DOT_SIZE_PX - DOT_SIZE_PX / 2;
    return parseFloat(node.style.getPropertyValue("--lane-x")) + Number(node.style.getPropertyValue("--stack")) * LANE_STEP_PX - DOT_SIZE_PX / 2;
}

function computeDotOverlapAreaPx(first: HTMLElement, second: HTMLElement): number {
    const topGapPx = Number(first.style.getPropertyValue("--axis-px")) - Number(second.style.getPropertyValue("--axis-px"));
    return Math.max(0, DOT_SIZE_PX - Math.abs(readDotLeftPx(first) - readDotLeftPx(second))) * Math.max(0, DOT_SIZE_PX - Math.abs(topGapPx));
}

function useRelayout(ticks: WireRulerTick[]): { count: number } {
    const relayouts = { count: 0 };
    registerSessionRelayout(async () => {
        relayouts.count++;
        renderAnnotationTrack(ticks);
    });
    return relayouts;
}

async function showDemoSessionDots(ticks: WireRulerTick[]): Promise<{ count: number }> {
    initLayer1Dom();
    storeAnnotations({ annotations: buildSessionDots() });
    renderAnnotationTrack(ticks);
    const relayouts = useRelayout(ticks);
    await toggleSessionDotLines();
    return relayouts;
}

function installInstantsFetch(): string[] {
    const instantsAskUrls: string[] = [];
    Object.assign(globalThis, {
        fetch: (url: unknown): Promise<Response> => {
            if (new URL(String(url), "http://localhost").pathname !== INSTANTS_PATHNAME) {
                return new Promise<Response>(() => {});
            }
            instantsAskUrls.push(String(url));
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [] }) } as unknown as Response);
        },
    });
    return instantsAskUrls;
}

test("test_with_session_ticks_the_dots_of_one_session_go_straight_down_the_column", async () => {
    // Scenario: s1 has three dots in row 1 (at 100 px) and one in row 3; each is one dot lower, the dots share one column, the count restarts per row.
    await showDemoSessionDots(buildRowTicks(0, true));
    assert.deepEqual([readAxisPx("a1"), readAxisPx("a2"), readAxisPx("a3")], [100, 100 + DOT_SIZE_PX, 100 + 2 * DOT_SIZE_PX]);
    assert.deepEqual([readLaneX("a2"), readLaneX("a3")], [readLaneX("a1"), readLaneX("a1")]);
    assert.equal(readAxisPx("a4"), 300);
});

test("test_with_session_ticks_no_two_dots_overlap", async () => {
    // Scenario: two sessions with three dots each in one row; the boxes of any two dots share no area.
    await showDemoSessionDots(buildRowTicks(0, true));
    const nodes = [...document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .anode")];
    assert.equal(nodes.length, 7);
    for (const [firstIndex, first] of nodes.entries()) {
        for (const second of nodes.slice(firstIndex + 1)) {
            assert.equal(computeDotOverlapAreaPx(first, second), 0, `${first.dataset["recordId"]} and ${second.dataset["recordId"]} overlap`);
        }
    }
});

test("test_with_time_ticks_dots_are_placed_by_time_as_today", async () => {
    // Scenario: ticks without dotBlockPx; a dot on a tick sits on it, a dot 10 minutes into row 1 sits between its tick and the next.
    await showDemoSessionDots(buildRowTicks(0, false));
    assert.equal(readAxisPx("a4"), 300);
    assert.ok(readAxisPx("a1") > 100);
    assert.ok(readAxisPx("a1") < 200);
});

test("test_turning_on_a_real_view_loads_the_dot_instants_once", async () => {
    // Scenario: a real view (no annotations, a jsonl path); the user turns the button on, off, and on again; the page asks for the instants once.
    const instantsAskUrls = installInstantsFetch();
    setUpSessionDotsPage();
    try {
        storeAnnotations({});
        renderAnnotationTrack(buildTicks());
        useRelayout(buildTicks());
        await toggleSessionDotLines();
        await toggleSessionDotLines();
        await toggleSessionDotLines();
        assert.equal(instantsAskUrls.length, 1);
    } finally {
        resetSessionDotsPage();
    }
});

test("test_every_toggle_asks_the_page_to_relayout", async () => {
    // Scenario: the button goes on, then off; each toggle runs the registered relayout once.
    const relayouts = await showDemoSessionDots(buildRowTicks(0, true));
    await toggleSessionDotLines();
    assert.equal(relayouts.count, 2);
});

test("test_toggle_keeps_the_top_row_in_place", async () => {
    // Scenario: row 4 is at 400 px and 10 px below the pane top; the relayout moves it to 9000 px, so it must stay 10 px below the top.
    initLayer1Dom();
    storeAnnotations({ annotations: buildSessionDots() });
    renderAnnotationTrack(buildRowTicks(0, false));
    setPaneSize(600, 390);
    useRelayout(buildRowTicks(8600, true));
    await toggleSessionDotLines();
    assert.equal(document.getElementById("timelineContainer")!.scrollTop, 8990);
});
