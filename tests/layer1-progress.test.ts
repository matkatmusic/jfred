// The Layer 1 page's progress strip (spec S18 feedback fixes, plan step 4c). The reported defect
// was a page that sat blank for ~10 seconds with nothing on it moving, so what these tests prove is
// VISIBILITY OVER TIME: the strip is up while the stream runs and gone once the timeline is drawn, a
// counted line fills it to its fraction, and a terminal error line lands somewhere readable.
//
// The counted-line test drives readLayer1ViewStream DIRECTLY rather than through the page.
// loadLayer1View's finally block calls hideLayer1Progress, which resets the fill to 0 and blanks the
// label, so nothing the stream painted survives the load it belongs to — routing that test through
// the page could only ever assert the reset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";
import { readLayer1ViewStream } from "../webapp/layer1-progress.ts";

// A complete but empty view — the terminal (kind-less) line of every stream below.
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

// The deep link the page needs before it will fetch at all: both roots named.
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// webapp/layer1-page.ts calls bootLayer1Page() at MODULE SCOPE, so the first import in this process
// boots the page a SECOND time and every load below would run twice. Absorb that boot here against a
// throwaway DOM: the empty query makes loadLayer1View return before it fetches anything.
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// A fresh page whose URL names both roots, its endpoint answering with `lines`, booted once.
// bootLayer1Page starts the load synchronously as far as its first await, so the strip is already
// up by the time this returns.
function openPageStreaming(lines: unknown[]): void {
    setupLayer1Dom(BOTH_ROOTS_SEARCH);
    stubStreamRoute("/api/layer1-view", lines);
    bootLayer1Page();
}

function checkLoadbarIsHidden(): boolean {
    return document.getElementById("loadbar")!.hasAttribute("hidden");
}

function readLoadbarLabel(): string | null {
    return document.getElementById("loadbar-label")!.textContent;
}

function readLoadbarFillWidth(): string {
    return (document.getElementById("loadbar-fill") as HTMLElement).style.width;
}

function readCrumbText(): string | null {
    return document.getElementById("crumb")!.textContent;
}

test("test_the_progress_bar_shows_while_the_view_streams_and_hides_when_it_ends", async () => {
    // Scenario (plan step 4c): the reported page showed nothing at all for the ~10 s a real build
    // takes. The strip must be up from the moment a load starts until the timeline is drawn, and
    // must not stay behind once it is.
    // Steps:
    // boot the page on a link naming both roots, with the view as the stream's only line.
    openPageStreaming([EMPTY_VIEW]);
    // the strip is already visible, carrying the opening stage's label.
    assert.equal(checkLoadbarIsHidden(), false);
    assert.equal(readLoadbarLabel(), "starting");
    // once the stream ends the view is drawn and the strip is hidden again.
    await flushAsyncWork();
    assert.equal(checkLoadbarIsHidden(), true);
    assert.equal(readCrumbText(), "0 pairs · 0 repo-only · 0 disk-only");
});

test("test_a_counted_progress_line_fills_the_bar_to_its_fraction", async () => {
    // Scenario (plan step 4c): a {current, total} line both fills the track and spells the count out
    // beside it, so the slow stage reads as progress rather than as a hang.
    // Steps:
    // set up the page's markup and stub a stream carrying one counted line BEFORE the view.
    setupLayer1Dom(BOTH_ROOTS_SEARCH);
    stubStreamRoute("/api/layer1-view", [
        { kind: "progress", label: "reading file history", current: 5, total: 10 },
        EMPTY_VIEW,
    ]);
    // read the stream directly — see this file's header for why the page cannot be used here.
    const view = await readLayer1ViewStream<{ pairs: unknown[] }>("/api/layer1-view?progress=1");
    assert.deepEqual(view.pairs, []);
    // 5 of 10 is half the track, and the label spells the same count out in full.
    assert.equal(readLoadbarFillWidth(), "50%");
    assert.equal(readLoadbarLabel(), "reading file history — 5 / 10");
});

test("test_a_terminal_error_line_lands_in_the_crumb_and_clears_the_bar", async () => {
    // Scenario (plan step 4c): a bad `ref` is only discovered after the stream has already opened
    // with 200, so its refusal arrives as a terminal error LINE rather than as a status code. The
    // crumb is the page's whole error surface — there is no alert(), which would block headless
    // automation — and a failed load must not leave the strip stuck on screen.
    // Steps:
    // boot the page on a stream whose only line is a terminal error.
    openPageStreaming([{ kind: "error", label: "unknown ref: nope" }]);
    await flushAsyncWork();
    assert.equal(readCrumbText(), "Error: unknown ref: nope");
    assert.equal(checkLoadbarIsHidden(), true);
});
