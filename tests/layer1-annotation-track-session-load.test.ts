// Task 907: what the session column loads, when it relayouts, and when a new view turns it off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import type { WireAnnotation, WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const { isSessionColumnShown, registerSessionRelayout, renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const ticks = buildTicks();

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildAnswer(dots: WireAnnotation[]): WireSessionDots {
    const sessionSpans = [{ sessionId: dots[0]!.sessionId, first: dots[0]!.instant, last: dots[0]!.instant }];
    return { annotations: dots, sessionSpans };
}

function readDrawnDots(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .anode")];
}

function useRelayout(relayoutTicks: WireRulerTick[]): { count: number } {
    const relayouts = { count: 0 };
    registerSessionRelayout(async () => {
        relayouts.count++;
        renderAnnotationTrack(relayoutTicks);
    });
    return relayouts;
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

test("test_turning_on_a_demo_view_makes_no_ask", () => runOnRealPage(async () => {
    // Scenario: the page has a jsonl path, but the view carries its own annotations (a demo view).
    const fetchStub = installDeferredDotsFetch();
    setPaneSize(600, 0);
    storeAnnotations({ annotations: [buildDot("d1", ticks[2]!.instant, "s1")] });
    renderAnnotationTrack(ticks);
    useRelayout(ticks);
    // The user turns the button on and waits past the debounce.
    await toggleSessionDotLines();
    await wait(400);
    // The dot is drawn from the view, and the page asked for neither the instants nor the dots.
    assert.equal(readDrawnDots().length, 1);
    assert.equal(fetchStub.instantsAskUrls.length, 0);
    assert.equal(fetchStub.askUrls.length, 0);
}));

test("test_a_dots_answer_does_not_ask_for_a_relayout", () => runOnRealPage(async () => {
    // Scenario: a real view; the button goes on, which relayouts once.
    const fetchStub = installDeferredDotsFetch();
    setPaneSize(600, 0);
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    const relayouts = useRelayout(ticks);
    await toggleSessionDotLines();
    await wait(400);
    assert.equal(relayouts.count, 1);
    assert.equal(fetchStub.askUrls.length, 1);
    // The dots ask is answered with one dot.
    fetchStub.finishAsk(0, buildAnswer([buildDot("d1", ticks[2]!.instant, "s1")]));
    await wait(50);
    // The dot is drawn and the relayout count did not move.
    assert.equal(readDrawnDots().length, 1);
    assert.equal(readDrawnDots()[0]!.dataset["recordId"], "d1");
    assert.equal(relayouts.count, 1);
}));

test("test_loading_a_new_view_turns_the_session_column_off", async () => {
    // Scenario: a demo view with one dot; the button is on and the dot is drawn.
    initLayer1Dom();
    storeAnnotations({ annotations: [buildDot("old", ticks[2]!.instant, "s1")] });
    renderAnnotationTrack(ticks);
    useRelayout(ticks);
    await toggleSessionDotLines();
    assert.equal(isSessionColumnShown(), true);
    assert.equal(readDrawnDots().length, 1);
    // A new view with another dot loads and the page draws its stage again.
    storeAnnotations({ annotations: [buildDot("new", ticks[3]!.instant, "s2")] });
    renderAnnotationTrack(ticks);
    // The button is off and the user sees no dots.
    assert.equal(isSessionColumnShown(), false);
    assert.equal(readDrawnDots().length, 0);
});
