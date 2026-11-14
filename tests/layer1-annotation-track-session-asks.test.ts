// Tasks 908-910 step 6: in session layout the ask reaches the dots before the first tick and after the last tick.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installDeferredDotsFetch, resetSessionDotsPage, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { EARLIEST_INSTANT, LATEST_INSTANT } from "../webapp/layer1-components/session-column/layer1-session-dots-viewport.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const { registerSessionRelayout, renderAnnotationTrack, storeAnnotations, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const TALL_ROW_PX = 5000;
const SESSION_DOT_BLOCK_PX = 4900;

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readAskParams(askUrl: string | undefined): URLSearchParams {
    return new URL(askUrl!, "http://localhost").searchParams;
}

// Four ticks, one per hour, each row 5000 px tall; session ticks also carry the dot block height.
function buildTicks(hasDotBlock: boolean): WireRulerTick[] {
    const builtTicks: WireRulerTick[] = [];
    for (let index = 0; index < 4; index++) {
        const instant = new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 3600_000).toISOString();
        const tick: WireRulerTick = { instant, axisPx: index * TALL_ROW_PX, eventCount: 1 };
        if (hasDotBlock) {
            tick.dotBlockPx = SESSION_DOT_BLOCK_PX;
        }
        builtTicks.push(tick);
    }
    return builtTicks;
}

const timeTicks = buildTicks(false);
const ticks = buildTicks(true);

function scrollPaneTo(scrollTop: number): void {
    setPaneSize(600, scrollTop);
    getRequiredElementById("timelineContainer").dispatchEvent(new window.Event("scroll"));
}

function readLastAskUrl(askUrls: string[]): string | undefined {
    assert.ok(askUrls.length >= 1);
    return askUrls[askUrls.length - 1];
}

// Real order: time ticks first, the toggle's relayout draws the session ticks, then the pane sits at the wanted scroll.
async function turnSessionButtonOnAt(scrollTop: number): Promise<void> {
    setPaneSize(600, scrollTop);
    storeAnnotations({});
    renderAnnotationTrack(timeTicks);
    registerSessionRelayout(async () => {
        renderAnnotationTrack(ticks);
    });
    await toggleSessionDotLines();
    scrollPaneTo(scrollTop);
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

test("test_a_session_ask_at_the_top_reaches_back_to_the_earliest_instant", () => runOnRealPage(async () => {
    // Scenario: the pane shows the first row, so the ask starts at the earliest instant.
    const fetchStub = installDeferredDotsFetch();
    // Turn the button on with the pane scrolled to the top, then wait past the debounce.
    await turnSessionButtonOnAt(0);
    const params = readAskParams(readLastAskUrl(fetchStub.askUrls));
    // "from" is the earliest instant, not the first tick.
    assert.equal(params.get("from"), EARLIEST_INSTANT);
    // "to" is the second tick.
    assert.equal(params.get("to"), ticks[1]!.instant);
}));

test("test_a_session_ask_at_the_bottom_reaches_forward_to_the_latest_instant", () => runOnRealPage(async () => {
    // Scenario: the pane shows the last row, so the ask ends at the latest instant.
    const fetchStub = installDeferredDotsFetch();
    // Turn the button on with the pane scrolled to the bottom, then wait past the debounce.
    await turnSessionButtonOnAt(14800);
    const params = readAskParams(readLastAskUrl(fetchStub.askUrls));
    // "from" is the third tick.
    assert.equal(params.get("from"), ticks[2]!.instant);
    // "to" is the latest instant, not the last tick.
    assert.equal(params.get("to"), LATEST_INSTANT);
}));

test("test_a_session_ask_for_a_pane_inside_one_tall_row_covers_that_row", () => runOnRealPage(async () => {
    // Scenario: no tick is on screen; the pane sits inside the block of row 1, so the ask covers row 1 up to row 2.
    const fetchStub = installDeferredDotsFetch();
    // Turn the button on with the pane scrolled into the middle of row 1, then wait past the debounce.
    await turnSessionButtonOnAt(6000);
    const params = readAskParams(readLastAskUrl(fetchStub.askUrls));
    // "from" is the second tick.
    assert.equal(params.get("from"), ticks[1]!.instant);
    // "to" is the third tick.
    assert.equal(params.get("to"), ticks[2]!.instant);
}));
