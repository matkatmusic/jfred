// Task 901 step 3: the sideways scroll strip under the session column appears, scrolls the column, and survives redraws.

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

function scrollPaneTo(scrollTop: number): void {
    setPaneSize(600, scrollTop);
    getRequiredElementById("timelineContainer").dispatchEvent(new window.Event("scroll"));
}

function readStrip(): HTMLElement {
    return getRequiredElementById("sessionLaneStrip");
}

function stubStripGeometry(scrollWidth: number, clientWidth: number): void {
    Object.defineProperty(readStrip(), "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(readStrip(), "clientWidth", { configurable: true, value: clientWidth });
}

function readTrackWidth(): string {
    return getRequiredElementById("sessionDataContainer").style.getPropertyValue("--track-w");
}

// 14 spans over the same hours need 14 lanes: 18 + 13 * 17 + 22 = 261 px.
function buildWideSpans(): WireSessionSpan[] {
    const spans: WireSessionSpan[] = [];
    for (let index = 1; index <= WIDE_LANE_COUNT; index++) {
        spans.push(buildSpan(`S${index}`, 1, 10));
    }
    return spans;
}

test("test_a_wide_lane_list_shows_the_strip_and_keeps_the_full_track_width", async () => {
    // Scenario: 14 overlapping sessions need 261 px, the visible column is 227 px, so the strip is needed.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        // The strip measures 260 px of content in a 227 px box.
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: buildWideSpans() });
        // The strip is shown, and --track-w still holds the full lane width, not the cap.
        assert.ok(readStrip().classList.contains("is-needed"));
        assert.equal(readTrackWidth(), "261px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_narrow_lane_list_shows_no_strip", async () => {
    // Scenario: 2 overlapping sessions need 57 px, the content fits the box, so the strip stays hidden.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(227, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: [buildSpan("A", 1, 10), buildSpan("B", 1, 10)] });
        // The strip is not marked as needed, and --track-w is the narrow width.
        assert.equal(readStrip().classList.contains("is-needed"), false);
        assert.equal(readTrackWidth(), "57px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_scrolling_the_strip_moves_the_dots_and_lines_of_the_column", async () => {
    // Scenario: the user drags the strip 34 px sideways; the column shifts its dots and lines by 34 px.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [buildDot("d1", buildInstantAtHour(2), "S1")], sessionSpans: buildWideSpans() });
        // The strip scrolls to 34 px and fires its scroll event.
        const strip = readStrip();
        Object.defineProperty(strip, "scrollLeft", { configurable: true, writable: true, value: 34 });
        strip.dispatchEvent(new window.Event("scroll"));
        // The column holds the shift as a CSS variable.
        const column = getRequiredElementById("sessionDotLinesComponent");
        assert.equal(column.style.getPropertyValue("--lane-shift"), "34px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_the_strip_and_its_scroll_survive_a_pane_scroll", async () => {
    // Scenario: the window redraws on every pane scroll; the same strip element must stay in the column after it.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: buildWideSpans() });
        const stripBefore = readStrip();
        // The user scrolls the pane down 100 px.
        scrollPaneTo(100);
        // The strip is the same element, and the column still starts with the sticky head.
        assert.equal(readStrip(), stripBefore);
        const column = getRequiredElementById("sessionDotLinesComponent");
        assert.ok(column.firstElementChild!.classList.contains("ahead"));
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_the_session_button_off_removes_the_strip", async () => {
    // Scenario: the user turns the session button off; the strip leaves the page with the column.
    setUpSessionDotsPage();
    try {
        const asks = openRealTrack();
        stubStripGeometry(260, 227);
        await answerAsk(asks, 0, { annotations: [], sessionSpans: buildWideSpans() });
        // The strip exists while the button is on.
        assert.ok(readStrip());
        // The user turns the button off.
        toggleSessionDotLines();
        // The strip is gone.
        assert.equal(document.getElementById("sessionLaneStrip"), null);
    }
    finally {
        resetSessionDotsPage();
    }
});
