// Layer 1 progress strip (S18 step 4c): visible while the stream runs, gone once the timeline draws.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { readLayer1ViewStream, renderLoadbar } from "../webapp/layer1-components/loading-bar/layer1-progress.ts";
import { resetStepConsole, StepConsoleScope } from "../webapp/layer1-components/loading-bar/layer1-step-console.ts";

// A complete but empty view — the terminal (kind-less) line of every stream below.
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

// The deep link the page needs before it will fetch at all: both roots named.
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// layer1-page.ts boots at MODULE SCOPE; absorb that first boot against a throwaway DOM with an empty query.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");

// Fresh page naming both roots, endpoint answering `lines`; the strip is up by the time this returns.
function openPageStreaming(lines: unknown[]): void {
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    installStreamRoute("/api/layer1-view", lines);
    initLayer1Page();
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
    await waitForAsyncWork();
    assert.equal(checkLoadbarIsHidden(), true);
    assert.equal(readCrumbText(), "0 pairs · 0 repo-only · 0 disk-only");
});

test("test_a_counted_progress_line_fills_the_bar_to_its_fraction", async () => {
    // Scenario (step 4c): a {current, total} line fills the track and spells the count out beside it.
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    installStreamRoute("/api/layer1-view", [
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

test("test_a_countless_paint_marks_the_fill_indeterminate_and_a_counted_paint_clears_it", () => {
    // Scenario: a stage with no count shows a moving bar; the first count returns the bar to its fraction.
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    const fill = document.getElementById("loadbar-fill") as HTMLElement;
    const labelHost = document.getElementById("loadbar-label") as HTMLElement;
    renderLoadbar(fill, labelHost, "starting");
    assert.equal(fill.classList.contains("indeterminate"), true);
    assert.equal(labelHost.textContent, "starting");
    renderLoadbar(fill, labelHost, "reading file history", 5, 10);
    assert.equal(fill.classList.contains("indeterminate"), false);
    assert.equal(fill.style.width, "50%");
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
    // Scenario (task 302): Yes-cancel aborts the stream; crumb reports cancellation, strip hides, fileBubbleContainer stays empty.
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    stubHangingViewRoute();
    initLayer1Page();
    await waitForAsyncWork();
    assert.equal(checkLoadbarIsHidden(), false);
    document.getElementById("loadbar-cancel")!.click();
    // the confirm row replaced the button, task-164 style...
    assert.equal(document.getElementById("loadbar-cancel")!.hasAttribute("hidden"), true);
    assert.equal(document.getElementById("loadbar-confirm")!.hasAttribute("hidden"), false);
    document.getElementById("loadbar-confirm-yes")!.click();
    await waitForAsyncWork();
    // ...and the abort is a clean stop: plain crumb, hidden strip, empty fileBubbleContainer.
    assert.equal(readCrumbText(), "load cancelled");
    assert.equal(checkLoadbarIsHidden(), true);
    assert.equal(Array.from(document.getElementById("fileBubbleContainer")!.children).filter((child) => child.id !== "detailsPaneContainer").length, 0);
});

test("test_a_terminal_error_line_lands_in_the_crumb_and_clears_the_bar", async () => {
    // Scenario (step 4c): a bad ref refuses AFTER 200, so its error line lands in the crumb.
    openPageStreaming([{ kind: "error", label: "unknown ref: nope" }]);
    await waitForAsyncWork();
    assert.equal(readCrumbText(), "Error: unknown ref: nope");
    assert.equal(checkLoadbarIsHidden(), true);
});

// Fresh DOM with one popup step-console host and an empty console, ready for a direct stream read.
function openStepConsoleHost(): HTMLElement {
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    document.body.insertAdjacentHTML("beforeend", '<div id="test-steps" data-step-console="popup"></div>');
    resetStepConsole(StepConsoleScope.popup);
    return document.getElementById("test-steps")!;
}

function readStepRowTexts(host: HTMLElement): string[] {
    return Array.from(host.children).map((row) => row.textContent!);
}

test("test_two_progress_lines_in_one_chunk_leave_both_rows_in_the_step_console", async () => {
    // Scenario (task 893): the bar paints only the last line of a chunk, but the console lists every step.
    const host = openStepConsoleHost();
    installStreamRoute("/api/layer1-view", [
        { kind: "progress", label: "reading file history", current: 5, total: 10 },
        { kind: "progress", label: "pairing files", current: 3, total: 4 },
        EMPTY_VIEW,
    ]);
    await readLayer1ViewStream("/api/layer1-view?progress=1");
    // the bar shows only the last line...
    assert.equal(readLoadbarLabel(), "pairing files — 3 / 4");
    // ...while the console keeps both steps (the stream ended, so both read done).
    assert.deepEqual(readStepRowTexts(host), ["reading file historydone (10)", "pairing filesdone (4)"]);
});

test("test_a_first_line_with_steps_makes_waiting_rows_for_steps_not_started", async () => {
    // Scenario (task 893): the planned step labels show as waiting until their own progress line arrives.
    const host = openStepConsoleHost();
    installStreamRoute("/api/layer1-view", [
        { kind: "progress", label: "reading file history", steps: ["reading file history", "pairing files", "drawing"] },
        EMPTY_VIEW,
    ]);
    await readLayer1ViewStream("/api/layer1-view?progress=1");
    // finishing the stream marks only the running row done; planned-but-unstarted rows stay waiting.
    assert.deepEqual(readStepRowTexts(host), ["reading file historydone", "pairing fileswaiting", "drawingwaiting"]);
});

test("test_the_step_console_marks_every_running_row_done_when_the_stream_ends_with_the_view", async () => {
    // Scenario (task 893): the last progress line leaves a running row; the view arriving finishes it.
    const host = openStepConsoleHost();
    installStreamRoute("/api/layer1-view", [
        { kind: "progress", label: "pairing files", current: 3, total: 4 },
        EMPTY_VIEW,
    ]);
    await readLayer1ViewStream("/api/layer1-view?progress=1");
    assert.deepEqual(readStepRowTexts(host), ["pairing filesdone (4)"]);
});

test("test_a_stream_with_no_progress_lines_leaves_the_step_console_empty", async () => {
    // Scenario (task 893): a plain view has no steps to list.
    const host = openStepConsoleHost();
    installStreamRoute("/api/layer1-view", [EMPTY_VIEW]);
    await readLayer1ViewStream("/api/layer1-view?progress=1");
    assert.equal(host.children.length, 0);
});
