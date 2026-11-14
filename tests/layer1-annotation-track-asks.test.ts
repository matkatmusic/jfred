// Task 888 step 21c: the real-mode track asks for the dots of the visible rows, draws the answer, and never loops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import { SESSION_DOTS_PATHNAME, SESSION_DOT_INSTANTS_PATHNAME, buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { buildSessionColor } from "../webapp/layer1-components/session-column/layer1-session-colors.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation, WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const { renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const ticks = buildTicks();

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildAnswer(dots: WireAnnotation[]): WireSessionDots {
    const sessionSpans = dots.map((dot) => ({ sessionId: dot.sessionId, first: dot.instant, last: dot.instant }));
    return { annotations: dots, sessionSpans };
}

function scrollPaneTo(scrollTop: number): void {
    setPaneSize(600, scrollTop);
    getRequiredElementById("timelineContainer").dispatchEvent(new window.Event("scroll"));
}

function readDrawnDots(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .anode")];
}

function readAskParams(askUrl: string | undefined): URLSearchParams {
    return new URL(askUrl!, "http://localhost").searchParams;
}

// Loads a real view (no annotations), turns the button on and waits past the debounce.
async function turnSessionButtonOn(): Promise<void> {
    setPaneSize(600, 0);
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    await toggleSessionDotLines();
    await wait(300);
}

async function runOnRealPage(body: () => Promise<void>): Promise<void> {
    setUpSessionDotsPage();
    try {
        await body();
    }
    finally {
        resetSessionDotsPage();
    }
}

test("test_turning_the_button_on_asks_for_the_instants_of_the_visible_rows", () => runOnRealPage(async () => {
    // Scenario: scrollTop 0, clientHeight 600, margin 300: rows 0..18 are in the window, plus one more.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    assert.equal(fetchStub.askUrls.length, 1);
    const params = readAskParams(fetchStub.askUrls[0]);
    assert.equal(params.get("dir"), "/work");
    assert.deepEqual(params.getAll("jsonl"), ["/logs"]);
    assert.equal(params.get("from"), ticks[0]!.instant);
    assert.equal(params.get("to"), ticks[19]!.instant);
}));

test("test_scrolling_asks_again_once_after_the_debounce", () => runOnRealPage(async () => {
    // Scenario: three scroll events in a row to 2000 px make exactly one more ask, from the new rows.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    scrollPaneTo(2000);
    scrollPaneTo(2000);
    scrollPaneTo(2000);
    await wait(300);
    assert.equal(fetchStub.askUrls.length, 2);
    assert.equal(readAskParams(fetchStub.askUrls[1]).get("from"), ticks[33]!.instant);
}));

test("test_an_answer_never_triggers_another_ask", () => runOnRealPage(async () => {
    // Scenario: after the answer is drawn, 400 ms of quiet make no new ask.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    fetchStub.finishAsk(0, buildAnswer([buildDot("d1", ticks[2]!.instant, "s1")]));
    await wait(400);
    assert.equal(fetchStub.askUrls.length, 1);
}));

test("test_a_zero_dot_answer_keeps_the_button_and_draws_no_dots", () => runOnRealPage(async () => {
    // Scenario: the server answers with no dots and no sessions.
    installFetchRoutes({ [SESSION_DOT_INSTANTS_PATHNAME]: { sessions: [] }, [SESSION_DOTS_PATHNAME]: { annotations: [], sessionSpans: [] } });
    await turnSessionButtonOn();
    assert.equal(document.getElementById("session-toggle")!.hidden, false);
    assert.equal(readDrawnDots().length, 0);
}));

test("test_the_dots_of_an_answer_are_drawn_with_their_letters_and_the_session_color", () => runOnRealPage(async () => {
    // Scenario: an assistant dot of session s1 and a user dot of session s2 come back.
    const assistantDot = buildDot("d1", ticks[2]!.instant, "s1", WireRecordKind.assistant);
    const userDot = buildDot("d2", ticks[3]!.instant, "s2");
    installFetchRoutes({ [SESSION_DOT_INSTANTS_PATHNAME]: { sessions: [] }, [SESSION_DOTS_PATHNAME]: buildAnswer([assistantDot, userDot]) });
    await turnSessionButtonOn();
    const drawn = readDrawnDots();
    assert.deepEqual(drawn.map((dot) => dot.textContent), ["a", "u"]);
    assert.deepEqual(drawn.map((dot) => dot.style.getPropertyValue("--session-color")), [buildSessionColor(0), buildSessionColor(1)]);
}));

test("test_turning_the_button_off_removes_the_track_and_stops_asking", () => runOnRealPage(async () => {
    // Scenario: the button goes off, then the pane scrolls: no track and no new ask.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    await toggleSessionDotLines();
    scrollPaneTo(2000);
    await wait(300);
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    assert.equal(fetchStub.askUrls.length, 1);
}));

test("test_a_new_view_load_drops_an_answer_still_in_flight", () => runOnRealPage(async () => {
    // Scenario: ask 0 is still open when a new view loads; its answer arrives after that and draws nothing.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    storeAnnotations({});
    fetchStub.finishAsk(0, buildAnswer([buildDot("d1", ticks[2]!.instant, "s1")]));
    await wait(50);
    assert.equal(readDrawnDots().length, 0);
}));

test("test_an_answer_that_arrives_after_a_newer_ask_is_dropped", () => runOnRealPage(async () => {
    // Scenario: ask 1 (after a scroll) is answered first, then the late answer of ask 0 arrives: only ask 1's dot stays.
    const fetchStub = installDeferredDotsFetch();
    await turnSessionButtonOn();
    scrollPaneTo(2000);
    await wait(300);
    fetchStub.finishAsk(1, buildAnswer([buildDot("newer", ticks[40]!.instant, "s1")]));
    fetchStub.finishAsk(0, buildAnswer([buildDot("older", ticks[2]!.instant, "s1")]));
    await wait(50);
    assert.deepEqual(readDrawnDots().map((dot) => dot.dataset["recordId"]), ["newer"]);
}));
