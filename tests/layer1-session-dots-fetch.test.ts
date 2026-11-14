// Task 888: asking /api/layer1-session-dots: debounce, newest answer wins, loading bar when slow.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDot, installDeferredDotsFetch, SESSION_DOTS_PATHNAME } from "./layer1-session-dots-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

initLayer1Dom();
const {
    buildSessionDotsUrl,
    fetchSessionDots,
    runSessionDotsFetch,
    scheduleSessionDotsFetch,
    stopSessionDotsFetch,
} = await import("../webapp/layer1-components/session-column/layer1-session-dots-fetch.ts");

const REQUEST = {
    dir: "/work",
    jsonlFolders: ["/logs/a", "/logs/b"],
    range: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T05:00:00.000Z" },
};

function buildAnswer(dotId: string): WireSessionDots {
    return { annotations: [buildDot(dotId, "2026-06-01T01:00:00.000Z", "s1")], sessionSpans: [] };
}

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

test("test_the_url_carries_dir_every_jsonl_folder_from_and_to", () => {
    // Build the url for a request with two jsonl folders.
    const url = new URL(buildSessionDotsUrl(REQUEST), "http://localhost:7343");
    // The path is the dots route.
    assert.equal(url.pathname, SESSION_DOTS_PATHNAME);
    // The dir, both folders, from and to are all in the query.
    assert.equal(url.searchParams.get("dir"), "/work");
    assert.deepEqual(url.searchParams.getAll("jsonl"), ["/logs/a", "/logs/b"]);
    assert.equal(url.searchParams.get("from"), REQUEST.range.from);
    assert.equal(url.searchParams.get("to"), REQUEST.range.to);
});

test("test_a_failed_answer_throws_with_the_status", async () => {
    // The server answers 500.
    Object.assign(globalThis, {
        fetch: async (): Promise<Response> => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    });
    // The ask rejects and the message names the status.
    await assert.rejects(fetchSessionDots(REQUEST), /500/);
});

test("test_two_schedules_within_the_debounce_make_one_ask", async () => {
    const deferredFetch = installDeferredDotsFetch();
    const appliedAnswers: WireSessionDots[] = [];
    function readRequest() {
        return REQUEST;
    }
    function applyDots(dots: WireSessionDots): void {
        appliedAnswers.push(dots);
    }
    // Schedule twice at once.
    scheduleSessionDotsFetch(readRequest, applyDots);
    scheduleSessionDotsFetch(readRequest, applyDots);
    // Wait past the debounce.
    await waitMilliseconds(250);
    // Only one ask went out.
    assert.equal(deferredFetch.askUrls.length, 1);
    // Finish it so no ask stays in flight.
    deferredFetch.finishAsk(0, buildAnswer("only"));
    await waitMilliseconds(20);
    assert.equal(appliedAnswers.length, 1);
});

test("test_an_answer_that_arrives_after_a_newer_ask_is_dropped", async () => {
    const deferredFetch = installDeferredDotsFetch();
    const appliedAnswers: WireSessionDots[] = [];
    function readRequest() {
        return REQUEST;
    }
    function applyDots(dots: WireSessionDots): void {
        appliedAnswers.push(dots);
    }
    // Two asks in a row.
    const firstRun = runSessionDotsFetch(readRequest, applyDots);
    const secondRun = runSessionDotsFetch(readRequest, applyDots);
    // The second ask is answered first, then the first.
    const secondAnswer = buildAnswer("second");
    deferredFetch.finishAsk(1, secondAnswer);
    deferredFetch.finishAsk(0, buildAnswer("first"));
    await Promise.all([firstRun, secondRun]);
    // Only the second answer was applied.
    assert.equal(appliedAnswers.length, 1);
    assert.equal(appliedAnswers[0], secondAnswer);
});

test("test_stopping_drops_an_answer_still_in_flight", async () => {
    const deferredFetch = installDeferredDotsFetch();
    let appliedCount = 0;
    function readRequest() {
        return REQUEST;
    }
    function applyDots(): void {
        appliedCount += 1;
    }
    // One ask is in flight.
    const run = runSessionDotsFetch(readRequest, applyDots);
    // A new view load stops the fetching.
    stopSessionDotsFetch();
    // The ask is answered afterwards.
    deferredFetch.finishAsk(0, buildAnswer("late"));
    await run;
    // The late answer was never applied.
    assert.equal(appliedCount, 0);
});

test("test_a_request_function_that_returns_nothing_makes_no_ask", async () => {
    const deferredFetch = installDeferredDotsFetch();
    function readNothing() {
        return undefined;
    }
    function applyDots(): void {
        assert.fail("no answer should be applied");
    }
    // The request function has nothing to ask.
    await runSessionDotsFetch(readNothing, applyDots);
    // No ask went out.
    assert.equal(deferredFetch.askUrls.length, 0);
});

test("test_a_slow_ask_shows_the_loading_bar_and_the_answer_hides_it", async () => {
    const deferredFetch = installDeferredDotsFetch();
    function readRequest() {
        return REQUEST;
    }
    function applyDots(): void {}
    // One ask is in flight.
    const run = runSessionDotsFetch(readRequest, applyDots);
    // Wait past the slow limit: the bar shows.
    await waitMilliseconds(1100);
    const loadbar = document.getElementById("loadbar")!;
    assert.equal(loadbar.hasAttribute("hidden"), false);
    // The answer arrives: the bar is hidden.
    deferredFetch.finishAsk(0, buildAnswer("slow"));
    await run;
    assert.equal(loadbar.hasAttribute("hidden"), true);
});
