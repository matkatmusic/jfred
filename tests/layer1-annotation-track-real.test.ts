// Task 888 step 21a: a real view (no annotations) keeps the session button when the page has jsonl paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDot, buildTicks, installDeferredDotsFetch, resetSessionDotsPage, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";

const { writeSourcePaths } = await import("../webapp/layer1-components/top-bars/layer1-source-paths.ts");
const { renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const RULER_PART_SELECTOR = "#ruler-head, .ruler-sessions, [data-full-time], .ttime, .tcount, .sline";
const DEBOUNCE_PLUS_SLACK_MS = 300;

// setUpSessionDotsPage boots the page, whose settings fetch must hit a stub, not Node's real fetch.
installDeferredDotsFetch();

function readSessionButtonIsHidden(): boolean {
    return (getRequiredElementById("session-toggle") as HTMLButtonElement).hidden;
}

function countRulerParts(): number {
    return document.querySelectorAll(RULER_PART_SELECTOR).length;
}

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("test_a_real_view_with_jsonl_paths_shows_the_session_button", () => {
    // Scenario: the view has no annotations and the page has a jsonl path; the button stays visible.
    setUpSessionDotsPage();
    try {
        // The view loads with no annotations and the ruler is drawn.
        storeAnnotations({});
        renderAnnotationTrack(buildTicks());
        // The user sees the session button.
        assert.equal(readSessionButtonIsHidden(), false);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_real_view_without_jsonl_paths_keeps_the_session_button_hidden", () => {
    // Scenario: the view has no annotations and the page has no jsonl path; the button stays hidden.
    setUpSessionDotsPage();
    try {
        // The page has no jsonl path.
        writeSourcePaths(SourceKind.jsonl, []);
        // The view loads with no annotations and the ruler is drawn.
        storeAnnotations({});
        renderAnnotationTrack(buildTicks());
        // The user does not see the session button.
        assert.equal(readSessionButtonIsHidden(), true);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_real_view_has_no_ruler_head_and_no_ruler_row_display_with_the_button_on_or_off", () => {
    // Scenario: a real view never shows the ruler head or the ruler row display.
    setUpSessionDotsPage();
    installDeferredDotsFetch();
    try {
        storeAnnotations({});
        renderAnnotationTrack(buildTicks());
        // Button off: none of the ruler parts exist.
        assert.equal(countRulerParts(), 0);
        // Button on: none of the ruler parts exist.
        toggleSessionDotLines();
        assert.equal(countRulerParts(), 0);
        // Button off again: none of the ruler parts exist.
        toggleSessionDotLines();
        assert.equal(countRulerParts(), 0);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_fixture_view_with_jsonl_paths_never_asks_the_server", async () => {
    // Scenario: a fixture view (it has annotations) never asks the server, even with jsonl paths.
    setUpSessionDotsPage();
    const fetchStub = installDeferredDotsFetch();
    try {
        // The view loads with one dot, and the ruler is drawn.
        storeAnnotations({ annotations: [buildDot("fixture-dot", "2026-06-01T00:30:00Z", "s1")] });
        renderAnnotationTrack(buildTicks());
        // The user turns the session button on and waits past the debounce.
        toggleSessionDotLines();
        await waitMilliseconds(DEBOUNCE_PLUS_SLACK_MS);
        // The page made no ask.
        assert.deepEqual(fetchStub.askUrls, []);
    }
    finally {
        resetSessionDotsPage();
    }
});
