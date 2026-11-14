// Task 888 step 21b: lanes, colors, width and session lines come from the whole-index spans of every answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import type { DeferredDotsFetch } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { computeLaneX } from "../webapp/layer1-components/session-column/layer1-session-lanes.ts";
import type { WireAnnotation, WireSessionDots, WireSessionSpan } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const { renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const DEBOUNCE_PLUS_SLACK_MS = 300;
const ANSWER_SETTLE_MS = 100;
const ticks = buildTicks();

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Hour k is tick k; a negative hour is before the ruler and a hour past 69 is after it.
function buildInstantAtHour(hour: number): string {
    return new Date(Date.parse(ticks[0]!.instant) + hour * 3600_000).toISOString();
}

function buildSpan(sessionId: string, firstHour: number, lastHour: number): WireSessionSpan {
    return { sessionId, first: buildInstantAtHour(firstHour), last: buildInstantAtHour(lastHour) };
}

function buildSessionDot(id: string, sessionId: string, hour: number): WireAnnotation {
    return buildDot(id, buildInstantAtHour(hour), sessionId);
}

// The view loads with no annotations, the user turns the session button on: ask number 0 starts.
async function openRealTrack(): Promise<DeferredDotsFetch> {
    setPaneSize(600, 0);
    const asks = installDeferredDotsFetch();
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    await toggleSessionDotLines();
    return asks;
}

async function answerAsk(asks: DeferredDotsFetch, askIndex: number, answer: WireSessionDots): Promise<void> {
    await waitMilliseconds(DEBOUNCE_PLUS_SLACK_MS);
    asks.finishAsk(askIndex, answer);
    await waitMilliseconds(ANSWER_SETTLE_MS);
}

function scrollPaneTo(scrollTop: number): void {
    setPaneSize(600, scrollTop);
    getRequiredElementById("timelineContainer").dispatchEvent(new window.Event("scroll"));
}

function readSessionLine(sessionId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .sline[data-session-id="${sessionId}"]`);
}

function readDot(recordId: string): HTMLElement {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .anode[data-record-id="${recordId}"]`)!;
}

function readTrackWidth(): string {
    return getRequiredElementById("sessionDataContainer").style.getPropertyValue("--track-w");
}

test("test_colors_and_lanes_do_not_change_when_the_window_changes", async () => {
    // Scenario: sessions A and B overlap; answer 1 holds only A dots, answer 2 (after a scroll) holds only B dots.
    setUpSessionDotsPage();
    try {
        const asks = await openRealTrack();
        const spans = [buildSpan("A", 1, 4), buildSpan("B", 2, 5)];
        // Answer 1 holds only A dots: both session lines are drawn.
        await answerAsk(asks, 0, { annotations: [buildSessionDot("a1", "A", 1), buildSessionDot("a2", "A", 4)], sessionSpans: spans });
        const lineOfB = readSessionLine("B")!;
        assert.ok(readSessionLine("A"));
        assert.ok(lineOfB);
        const colorOfB = lineOfB.style.getPropertyValue("--session-color");
        // The user scrolls a little, and answer 2 holds only B dots.
        scrollPaneTo(100);
        await answerAsk(asks, 1, { annotations: [buildSessionDot("b1", "B", 2)], sessionSpans: spans });
        // The B dot has the color of the B line and the second lane.
        assert.equal(readDot("b1").style.getPropertyValue("--session-color"), colorOfB);
        assert.equal(readDot("b1").style.getPropertyValue("--lane-x"), `${computeLaneX(1, 0)}px`);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_the_session_line_comes_from_the_full_span_when_only_one_dot_is_fetched", async () => {
    // Scenario: session A runs from tick 1 (50 px) to tick 10 (500 px); the answer holds one A dot at tick 5.
    setUpSessionDotsPage();
    try {
        const asks = await openRealTrack();
        await answerAsk(asks, 0, { annotations: [buildSessionDot("a5", "A", 5)], sessionSpans: [buildSpan("A", 1, 10)] });
        // The line runs over the whole span, not from the one dot.
        const line = readSessionLine("A")!;
        assert.equal(line.style.getPropertyValue("--axis-px"), "50");
        assert.equal(line.style.getPropertyValue("--span-px"), "450");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_the_track_width_follows_the_lanes_of_the_full_span_list", async () => {
    // Scenario: two overlapping spans need two lanes, but the answer holds dots of session A only.
    setUpSessionDotsPage();
    try {
        const asks = await openRealTrack();
        await answerAsk(asks, 0, { annotations: [buildSessionDot("a1", "A", 1)], sessionSpans: [buildSpan("A", 1, 4), buildSpan("B", 2, 5)] });
        // 18 + 17 + 22 = 57 px.
        assert.equal(readTrackWidth(), "57px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_session_wholly_outside_the_ruler_takes_no_lane_and_no_line", async () => {
    // Scenario: session O ends before the first tick; session A starts at the first tick.
    setUpSessionDotsPage();
    try {
        const asks = await openRealTrack();
        await answerAsk(asks, 0, { annotations: [buildSessionDot("a1", "A", 1)], sessionSpans: [buildSpan("O", -10, -5), buildSpan("A", 0, 3)] });
        // O has no line, and A keeps the first lane in a one-lane track.
        assert.equal(readSessionLine("O"), null);
        assert.ok(readSessionLine("A"));
        assert.equal(readDot("a1").style.getPropertyValue("--lane-x"), `${computeLaneX(0, 0)}px`);
        assert.equal(readTrackWidth(), "40px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_an_answer_with_no_sessions_keeps_the_track_one_lane_wide", async () => {
    // Scenario: the answer has no dots and no spans.
    setUpSessionDotsPage();
    try {
        const asks = await openRealTrack();
        await answerAsk(asks, 0, { annotations: [], sessionSpans: [] });
        // 18 + 22 = 40 px.
        assert.equal(readTrackWidth(), "40px");
    }
    finally {
        resetSessionDotsPage();
    }
});
