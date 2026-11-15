// Test for the Bars view wiring in webapp/layer1-page.ts and its neighbours: the slider, the canvas, the requests, the show row ticks, reverse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { buildNdjsonResponse, installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile } from "./layer1-bars-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot (no dir, so it stops early) against a throwaway DOM.
initLayer1Dom();
installFetchRoutes({});
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { isBarsViewOn } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { isReverseOn } = await import("../webapp/layer1-components/top-bars/layer1-reverse-toggle.ts");
const { rowsByTick } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
await waitForAsyncWork();

const COMMIT = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 60 };
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";
const VIEW = {
    pairs: [
        { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK },
        { path: "src/plain.ts", commits: [COMMIT], onDisk: ON_DISK },
    ],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [COMMIT, ON_DISK].map((node) => ({ instant: node.instant, axisPx: node.axisPx, eventCount: 2 })),
};
const INVERSE_REPOS_RESULT = {
    files: [
        buildInverseFile("src/run.ts", [buildDiskNowCommit(), buildInverseCommit({ instant: COMMIT.instant, commitHash: "c1" })]),
        buildInverseFile("src/plain.ts", [buildDiskNowCommit(), buildInverseCommit({ instant: COMMIT.instant, commitHash: "c1" })]),
    ],
};

let inverseReposRequests = 0;
let editsRequests = 0;

function installRecordingRoutes(): void {
    installFetchRoutes({});
    const fallbackFetch = globalThis.fetch;
    Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
        const requestedUrl = String(url);
        if (requestedUrl.includes("/api/layer1-view")) {
            return Promise.resolve(buildNdjsonResponse([VIEW]));
        }
        if (requestedUrl.includes("/api/layer1-inverse-repos")) {
            inverseReposRequests += 1;
            return Promise.resolve(buildNdjsonResponse([INVERSE_REPOS_RESULT]));
        }
        if (requestedUrl.includes("/api/layer1-edits")) {
            editsRequests += 1;
        }
        return fallbackFetch(url as string, init);
    } });
}

async function loadPage(): Promise<void> {
    inverseReposRequests = 0;
    editsRequests = 0;
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    installRecordingRoutes();
    await initLayer1Page();
    await waitForAsyncWork();
}

async function waitForBarsHistoryLoaded(): Promise<void> {
    const state = getBarsViewState();
    for (let attempt = 0; attempt < 200; attempt++) {
        const isLoaded = state.models.length > 0 && !state.isHistoryLoading;
        if (isLoaded) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("the Bars history did not finish loading");
}

async function moveSliderTo(value: "0" | "1"): Promise<void> {
    const slider = document.getElementById("barsViewSliderInput") as HTMLInputElement;
    slider.value = value;
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    await waitForAsyncWork();
}

async function pressLoad(): Promise<void> {
    document.getElementById("load")!.click();
    await waitForAsyncWork();
}

function readKindBox(kind: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(`#timelineViewControls [data-kind="${kind}"]`)!;
}

async function setKindBox(kind: string, isChecked: boolean): Promise<void> {
    const box = readKindBox(kind);
    box.checked = isChecked;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitForAsyncWork();
}

function listChunkMarkup(): string[] {
    return [...document.querySelectorAll("#barsRowList .barsHistoryBlock")].map((chunk) => chunk.outerHTML);
}

test("test_the_page_opens_in_bars_view", async () => {
    // Steps: load the page. The mode is Bars, the class is on #appWindow, the slider reads "0".
    await loadPage();
    assert.equal(isBarsViewOn(), true);
    assert.equal(document.getElementById("appWindow")!.classList.contains("barsViewOn"), true);
    assert.equal((document.getElementById("barsViewSliderInput") as HTMLInputElement).value, "0");
});

test("test_the_slider_sits_in_the_same_row_as_the_reverse_button", async () => {
    // Steps: load the page. The slider label and the reverse button have the same parent.
    await loadPage();
    assert.equal(document.getElementById("barsViewSlider")!.parentElement, document.getElementById("reverse-toggle")!.parentElement);
});

test("test_moving_the_slider_to_bubbles_removes_the_bars_view_class", async () => {
    // Steps: load the page, move the slider to Bubbles. The class is gone.
    await loadPage();
    await moveSliderTo("1");
    assert.equal(document.getElementById("appWindow")!.classList.contains("barsViewOn"), false);
    assert.equal(isBarsViewOn(), false);
});

test("test_rendering_the_view_in_bars_view_sends_one_inverse_repos_request", async () => {
    // Steps: load the page in Bars view. One inverse repos request was sent.
    await loadPage();
    assert.equal(inverseReposRequests, 1);
});

test("test_rendering_the_view_in_bubbles_view_sends_one_inverse_repos_request", async () => {
    // Steps: load the page, move to Bubbles, count from zero, press Load. One request was sent.
    await loadPage();
    await moveSliderTo("1");
    inverseReposRequests = 0;
    await pressLoad();
    assert.equal(inverseReposRequests, 1);
});

test("test_switching_to_bars_view_after_a_render_in_bubbles_view_sends_no_second_request", async () => {
    // Steps: load, move to Bubbles, count from zero, press Load (one request), move back to Bars. Still one request.
    await loadPage();
    await moveSliderTo("1");
    inverseReposRequests = 0;
    await pressLoad();
    await moveSliderTo("0");
    assert.equal(inverseReposRequests, 1);
});

test("test_ticking_edit_in_bars_view_sends_no_edits_request", async () => {
    // Steps: load the page in Bars view, tick Edit. No edits request was sent and the Edit box is ticked.
    await loadPage();
    await setKindBox("edit", true);
    assert.equal(editsRequests, 0);
    assert.equal(readKindBox("edit").checked, true);
});

test("test_ticking_edit_in_bars_view_sends_no_new_inverse_repos_request", async () => {
    // Steps: load the page in Bars view (one request), tick Edit. Still one request.
    await loadPage();
    await setKindBox("edit", true);
    assert.equal(inverseReposRequests, 1);
});

test("test_unticking_commit_in_bars_view_hides_the_commit_dots_and_leaves_the_chunks_unchanged", async () => {
    // Steps: load and wait for the full reveal. Keep the chunk markup. Untick Commit.
    await loadPage();
    await waitForBarsHistoryLoaded();
    const chunksBefore = listChunkMarkup();
    const commitDotsBefore = document.querySelectorAll("#barsRowList .BarDot.grp-commit").length;
    assert.ok(chunksBefore.length > 0);
    assert.ok(commitDotsBefore > 0);
    await setKindBox("commit", false);
    // The commit group is hidden by the attribute, the dots stay in the page, and every chunk is the same.
    assert.ok(document.getElementById("appWindow")!.getAttribute("data-hidden-kinds")!.split(" ").includes("commit"));
    assert.equal(document.querySelectorAll("#barsRowList .BarDot.grp-commit").length, commitDotsBefore);
    assert.deepEqual(listChunkMarkup(), chunksBefore);
});

test("test_edit_and_script_run_are_unticked_when_the_page_opens", async () => {
    // Steps: load the page. The Edit box and the script run box are unticked.
    await loadPage();
    assert.equal(readKindBox("edit").checked, false);
    assert.equal(readKindBox("script-run").checked, false);
});

test("test_the_bars_view_component_is_inside_the_canvas", async () => {
    // Steps: load the page. #barsViewComponent is a direct child of the canvas box.
    await loadPage();
    assert.equal(document.getElementById("barsViewComponent")!.parentElement, document.querySelector(".canvas"));
});

test("test_the_one_real_ruler_stays_in_the_canvas_in_both_views", async () => {
    // Steps: load the page. In Bars view and in Bubbles view there is one #timelineRulerComponent and the canvas holds it.
    await loadPage();
    for (const value of ["0", "1"] as const) {
        await moveSliderTo(value);
        assert.equal(document.querySelectorAll("#timelineRulerComponent").length, 1);
        assert.ok(document.querySelector(".canvas")!.contains(document.getElementById("timelineRulerComponent")));
    }
});

test("test_moving_the_slider_to_bars_with_reverse_on_turns_reverse_off", async () => {
    // Steps: load, move to Bubbles, press Reverse (it is on). Move to Bars.
    await loadPage();
    await moveSliderTo("1");
    document.getElementById("reverse-toggle")!.click();
    await waitForAsyncWork();
    assert.equal(isReverseOn(), true);
    await moveSliderTo("0");
    // Reverse is off, the button is not marked, and every tick of the ruler has a stored row with an instant.
    assert.equal(isReverseOn(), false);
    assert.equal(document.getElementById("reverse-toggle")!.classList.contains("current"), false);
    const ticks = [...document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")];
    assert.ok(ticks.length > 0);
    for (const tick of ticks) {
        assert.ok(rowsByTick.get(tick)!.instants.length >= 1);
    }
});
