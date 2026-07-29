// Layer 1 progress strip (S18 step 4c): visible while the stream runs, gone once the timeline draws.
//
// The counted-line test drives readLayer1ViewStream directly: loadLayer1View's finally resets the strip, erasing what it painted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";
import { readLayer1ViewStream } from "../webapp/layer1-progress.ts";

// A complete but empty view — the terminal (kind-less) line of every stream below.
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

// The deep link the page needs before it will fetch at all: both roots named.
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// layer1-page.ts boots at MODULE SCOPE; absorb that first boot against a throwaway DOM with an empty query.
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// Fresh page naming both roots, endpoint answering `lines`; the strip is up by the time this returns.
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
    // Scenario (step 4c): the strip must show from load start until the timeline is drawn, then hide.
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
    // Scenario (step 4c): a {current, total} line fills the track and spells the count out beside it.
    setupLayer1Dom(BOTH_ROOTS_SEARCH);
    stubStreamRoute("/api/layer1-view", [
        { kind: "progress", label: "reading file history", current: 5, total: 10 },
        EMPTY_VIEW,
    ]);
    // read the stream directly — see this file's header for why the page cannot be used here.
    const view = await readLayer1ViewStream<{ pairs: unknown[] }>("/api/layer1-view?progress=1");
    assert.deepEqual(view!.pairs, []);
    // 5 of 10 is half the track, and the label spells the same count out in full.
    assert.equal(readLoadbarFillWidth(), "50%");
    assert.equal(readLoadbarLabel(), "reading file history — 5 / 10");
});

// A view fetch that never answers and rejects with AbortError when its signal aborts; other paths 404.
function stubHangingViewRoute(): void {
    Object.assign(globalThis, {
        fetch: (url: unknown, options?: RequestInit): Promise<Response> => {
            if (!String(url).includes("/api/layer1-view")) {
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "nope" } as unknown as Response);
            }
            return new Promise((_resolve, reject) => {
                options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            });
        },
    });
}

test("test_cancel_confirm_aborts_the_load_and_the_crumb_says_so", async () => {
    // Scenario (task 302): Yes-cancel aborts the stream; crumb reports cancellation, strip hides, stage stays empty.
    setupLayer1Dom(BOTH_ROOTS_SEARCH);
    stubHangingViewRoute();
    bootLayer1Page();
    await flushAsyncWork();
    assert.equal(checkLoadbarIsHidden(), false);
    document.getElementById("loadbar-cancel")!.click();
    // the confirm row replaced the button, task-164 style...
    assert.equal(document.getElementById("loadbar-cancel")!.hasAttribute("hidden"), true);
    assert.equal(document.getElementById("loadbar-confirm")!.hasAttribute("hidden"), false);
    document.getElementById("loadbar-confirm-yes")!.click();
    await flushAsyncWork();
    // ...and the abort is a clean stop: plain crumb, hidden strip, empty stage.
    assert.equal(readCrumbText(), "load cancelled");
    assert.equal(checkLoadbarIsHidden(), true);
    assert.equal(document.getElementById("stage")!.children.length, 0);
});

test("test_a_terminal_error_line_lands_in_the_crumb_and_clears_the_bar", async () => {
    // Scenario (step 4c): a bad ref refuses AFTER 200, so its error line lands in the crumb.
    openPageStreaming([{ kind: "error", label: "unknown ref: nope" }]);
    await flushAsyncWork();
    assert.equal(readCrumbText(), "Error: unknown ref: nope");
    assert.equal(checkLoadbarIsHidden(), true);
});
