// Task 905: a sideways wheel over the session column moves the lane strip instead of the timeline pane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import type { DeferredDotsFetch } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import type { WireSessionDots, WireSessionSpan } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const { renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const DEBOUNCE_PLUS_SLACK_MS = 300;
const ANSWER_SETTLE_MS = 100;
const WIDE_LANE_COUNT = 14;
const STRIP_START_SCROLL_LEFT = 40;
const ticks = buildTicks();

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Hour k is tick k.
function buildInstantAtHour(hour: number): string {
    return new Date(Date.parse(ticks[0]!.instant) + hour * 3600_000).toISOString();
}

function buildSpan(sessionId: string, firstHour: number, lastHour: number): WireSessionSpan {
    return { sessionId, first: buildInstantAtHour(firstHour), last: buildInstantAtHour(lastHour) };
}

// The view loads with no annotations, the user turns the session button on: ask number 0 starts.
function openRealTrack(): DeferredDotsFetch {
    setPaneSize(600, 0);
    const asks = installDeferredDotsFetch();
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    toggleSessionDotLines();
    return asks;
}

async function answerAsk(asks: DeferredDotsFetch, askIndex: number, answer: WireSessionDots): Promise<void> {
    await waitMilliseconds(DEBOUNCE_PLUS_SLACK_MS);
    asks.finishAsk(askIndex, answer);
    await waitMilliseconds(ANSWER_SETTLE_MS);
}

function readStrip(): HTMLElement {
    return getRequiredElementById("sessionLaneStrip");
}

function readColumn(): HTMLElement {
    return getRequiredElementById("sessionDotLinesComponent");
}

function stubStripGeometry(scrollWidth: number, clientWidth: number): void {
    Object.defineProperty(readStrip(), "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(readStrip(), "clientWidth", { configurable: true, value: clientWidth });
}

function startStripAtMiddleScroll(): void {
    Object.defineProperty(readStrip(), "scrollLeft", { configurable: true, writable: true, value: STRIP_START_SCROLL_LEFT });
}

// 14 spans over the same hours need 14 lanes: 18 + 13 * 17 + 22 = 261 px.
function buildWideSpans(): WireSessionSpan[] {
    const spans: WireSessionSpan[] = [];
    for (let index = 1; index <= WIDE_LANE_COUNT; index++) {
        spans.push(buildSpan(`S${index}`, 1, 10));
    }
    return spans;
}

function dispatchWheel(target: HTMLElement, deltaX: number, deltaY: number): WheelEvent {
    const wheelEvent = new window.WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true });
    target.dispatchEvent(wheelEvent);
    return wheelEvent;
}

test("test_a_sideways_wheel_over_the_column_moves_the_lanes_and_not_the_pane", async () => {
    // Scenario: 14 lanes need the strip; the user wheels 25 px sideways over the column.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: buildWideSpans() });
        // The strip is needed and sits at 40 px.
        assert.ok(readStrip().classList.contains("is-needed"));
        startStripAtMiddleScroll();
        // The wheel moves 25 px sideways and 3 px up and down over the column.
        const wheelEvent = dispatchWheel(readColumn(), 25, 3);
        // The strip moved by 25 px, the column follows, and the pane is kept from scrolling sideways.
        assert.equal(readStrip().scrollLeft, 65);
        assert.equal(readColumn().style.getPropertyValue("--lane-shift"), "65px");
        assert.equal(wheelEvent.defaultPrevented, true);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_an_up_and_down_wheel_over_the_column_still_scrolls_the_pane", async () => {
    // Scenario: the user wheels 60 px up and down (and 5 px sideways) over the column.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: buildWideSpans() });
        startStripAtMiddleScroll();
        // The wheel moves mostly up and down.
        const wheelEvent = dispatchWheel(readColumn(), 5, 60);
        // The strip stays at 40 px, and the pane scrolls as before.
        assert.equal(readStrip().scrollLeft, STRIP_START_SCROLL_LEFT);
        assert.equal(wheelEvent.defaultPrevented, false);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_sideways_wheel_passes_through_when_the_lanes_fit", async () => {
    // Scenario: 2 lanes fit the column, so there is no strip to move; a sideways wheel goes to the pane.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(227, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: [buildSpan("A", 1, 10), buildSpan("B", 1, 10)] });
        // The strip is not needed.
        assert.equal(readStrip().classList.contains("is-needed"), false);
        startStripAtMiddleScroll();
        // The wheel moves 25 px sideways over the column.
        const wheelEvent = dispatchWheel(readColumn(), 25, 3);
        // The strip stays at 40 px, and the event is not prevented.
        assert.equal(readStrip().scrollLeft, STRIP_START_SCROLL_LEFT);
        assert.equal(wheelEvent.defaultPrevented, false);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_sideways_wheel_over_a_dot_moves_the_lanes", async () => {
    // Scenario: the pointer is over a dot inside the column; the wheel event bubbles up to the column.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [buildDot("d1", buildInstantAtHour(2), "S1")], sessionSpans: buildWideSpans() });
        startStripAtMiddleScroll();
        // The column holds a dot.
        const dot = readColumn().querySelector<HTMLElement>(".anode");
        assert.ok(dot);
        // The wheel moves 25 px sideways over the dot.
        const wheelEvent = dispatchWheel(dot, 25, 3);
        // The strip moved by 25 px, the column follows, and the pane is kept from scrolling sideways.
        assert.equal(readStrip().scrollLeft, 65);
        assert.equal(readColumn().style.getPropertyValue("--lane-shift"), "65px");
        assert.equal(wheelEvent.defaultPrevented, true);
    }
    finally {
        resetSessionDotsPage();
    }
});
