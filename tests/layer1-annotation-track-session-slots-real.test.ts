// Task 912 step 6: in real mode a lane x never depends on which dots are loaded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import type { DeferredDotsFetch } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { storeSessionDotInstants } from "../webapp/layer1-components/session-column/layer1-session-dot-instants.ts";
import type { WireAnnotation, WireSessionDots, WireSessionSpan } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const { registerSessionRelayout, renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const DEBOUNCE_PLUS_SLACK_MS = 300;
const ANSWER_SETTLE_MS = 100;
const SESSION_DOT_BLOCK_PX = 14;
const sessionTicks = buildTicks();
for (const tick of sessionTicks) {
    tick.dotBlockPx = SESSION_DOT_BLOCK_PX;
}

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Hour k is tick k; the instant is epoch ms.
function readInstantMsAtHour(hour: number): number {
    return Date.parse(sessionTicks[hour]!.instant);
}

function buildInstantAtHour(hour: number): string {
    return new Date(readInstantMsAtHour(hour)).toISOString();
}

function buildSpan(sessionId: string, firstHour: number, lastHour: number): WireSessionSpan {
    return { sessionId, first: buildInstantAtHour(firstHour), last: buildInstantAtHour(lastHour) };
}

function buildSessionDot(id: string, sessionId: string, hour: number): WireAnnotation {
    return buildDot(id, buildInstantAtHour(hour), sessionId);
}

// Session A has one dot at each of hours 1 to 4; session B has one dot at each of hours 2 to 5.
function storeTwoSessionInstants(): void {
    storeSessionDotInstants(new Map([
        ["A", [1, 2, 3, 4].map(readInstantMsAtHour)],
        ["B", [2, 3, 4, 5].map(readInstantMsAtHour)],
    ]));
}

// The instants are stored, so the toggle asks no instants fetch; only the dots ask (number 0) waits for the test.
async function openSlotsTrack(): Promise<DeferredDotsFetch> {
    setPaneSize(600, 0);
    const asks = installDeferredDotsFetch();
    storeAnnotations({});
    storeTwoSessionInstants();
    registerSessionRelayout(async () => { renderAnnotationTrack(sessionTicks); });
    renderAnnotationTrack(sessionTicks);
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

function readSessionLine(sessionId: string): HTMLElement {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .sline[data-session-id="${sessionId}"]`)!;
}

function readDot(recordId: string): HTMLElement {
    return document.querySelector<HTMLElement>(`#sessionDotLinesComponent .anode[data-record-id="${recordId}"]`)!;
}

function readTrackWidth(): string {
    return getRequiredElementById("sessionDataContainer").style.getPropertyValue("--track-w");
}

test("test_the_track_width_is_known_before_any_dot_is_loaded", async () => {
    // Scenario: sessions A and B overlap, their instants are stored, and no dots answer has arrived yet.
    setUpSessionDotsPage();
    try {
        await openSlotsTrack();
        // The slot count is 2, so the width is 18 + 17 + 22 = 57 px.
        assert.equal(readTrackWidth(), "57px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_session_line_has_its_slot_x_when_the_answer_holds_no_dots", async () => {
    // Scenario: the answer holds both session spans and no dots.
    setUpSessionDotsPage();
    try {
        const asks = await openSlotsTrack();
        await answerAsk(asks, 0, { annotations: [], sessionSpans: [buildSpan("A", 1, 4), buildSpan("B", 2, 5)] });
        // A takes slot 0, B starts while A still runs so B takes slot 1.
        assert.equal(readSessionLine("A").style.getPropertyValue("--lane-x"), "18px");
        assert.equal(readSessionLine("B").style.getPropertyValue("--lane-x"), "35px");
        assert.equal(readTrackWidth(), "57px");
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_the_dots_of_a_later_answer_use_the_same_lane_x", async () => {
    // Scenario: answer 1 has no dots; the user scrolls; answer 2 holds only the B dot at hour 2.
    setUpSessionDotsPage();
    try {
        const asks = await openSlotsTrack();
        const spans = [buildSpan("A", 1, 4), buildSpan("B", 2, 5)];
        await answerAsk(asks, 0, { annotations: [], sessionSpans: spans });
        scrollPaneTo(100);
        await answerAsk(asks, 1, { annotations: [buildSessionDot("b1", "B", 2)], sessionSpans: spans });
        // The B dot, the B line and the track width stay where the first answer put them.
        assert.equal(readDot("b1").style.getPropertyValue("--lane-x"), "35px");
        assert.equal(readDot("b1").style.getPropertyValue("--stack"), "0");
        assert.equal(readSessionLine("B").style.getPropertyValue("--lane-x"), "35px");
        assert.equal(readTrackWidth(), "57px");
    }
    finally {
        resetSessionDotsPage();
    }
});
