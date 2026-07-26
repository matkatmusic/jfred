// Task 260: clicking a row of the Layer 1 ruler centers that instant's bubble in the visible
// timeline area. The user's rule for a tick several bubbles share, settled 2026-07-25, has two
// stages: the bubble that BEGINS at that instant wins, and "if no bubble starts there, scroll to
// the node at that timestamp". Both stages are proved below, and the fixture is built so a naive
// one-stage implementation FAILS: the bubble that merely holds a node on the shared instant is
// drawn FIRST, so a plain document-order "any node here" search returns the wrong one.
//
// happy-dom implements no layout, so nothing here reads a scroll position — that would be measuring
// happy-dom rather than the page. The assertion is that the RIGHT ELEMENT was handed to native
// `scrollIntoView`, which is the entire contract this module has with the browser (same reasoning as
// tests/layer1-zoom.test.ts reading the published custom property instead of a measured box).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

// One placed moment as the endpoint ships it: absolute ruler offsets, no time arithmetic anywhere.
interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// The SHARED instant, the crux of the whole task. `EARLY_PX` is where the first bubble begins;
// `SHARED_PX` is where the second bubble begins AND where the first bubble has an interior commit
// node; `HELD_PX` is where no bubble begins but the first bubble's on-disk node sits — the fallback.
// Every offset is >= the page's 13 px tick-label collision threshold from its neighbour, so all four
// ticks are actually DRAWN and therefore clickable.
const EARLY_PX = 10;
const SHARED_PX = 40;
const HELD_PX = 90;
const LATE_PX = 110;

const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_HELD: FixtureInstant = { instant: "2026-06-09T09:00:00.000Z", axisPx: HELD_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// REAL 40-character hashes, as tests/layer1-page.test.ts uses: the page shortens the label, and a
// 7-character fake would let a broken truncation through unnoticed.
const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";
const LATE_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736";

// The bubble drawn FIRST: begins at EARLY_PX, carries an interior commit node on the shared instant,
// and its on-disk node is the only thing standing on HELD_PX.
const SPANNING_PAIR = {
    path: "src/spanning.ts",
    commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_HELD,
};

// The bubble drawn SECOND: it BEGINS on the shared instant, so stage 1 must pick it over the one
// above even though that one is found first.
const BEGINNING_PAIR = {
    path: "src/beginning.ts",
    commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Both pairs on one ruler. `ruler` is ascending, as the endpoint emits it.
function buildSharedInstantView(): object {
    return {
        pairs: [SPANNING_PAIR, BEGINNING_PAIR],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [AT_EARLY, AT_SHARED, AT_HELD, AT_LATE],
    };
}

// What one scrollIntoView call recorded: which element, and with which options.
interface ScrollRequest {
    target: HTMLElement;
    options: unknown;
}

// Replace native scrollIntoView with a recorder. Installed AFTER the page is booted because
// setupLayer1Dom builds a FRESH window per test — patching an earlier window's prototype would
// record nothing. happy-dom does implement scrollIntoView (as a no-op), so this is a spy on a real
// method rather than a stand-in for a missing one.
function recordScrollRequests(): ScrollRequest[] {
    const requests: ScrollRequest[] = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: unknown): void {
        requests.push({ target: this, options });
    };
    return requests;
}

// Set up a fresh page at a deep link naming both roots, stub the endpoint's NDJSON stream with the
// view as its terminal line, and boot. bootLayer1Page is called EXPLICITLY: node's module cache runs
// the module's own boot line only on the first import, so later tests would render nothing.
async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

// The drawn ruler row for one absolute offset. Fails loudly rather than returning undefined: a tick
// the collision skip dropped has no row to click, and a test aimed at one is testing nothing.
function clickRulerTickAt(axisPx: number): void {
    const tick = [...document.querySelectorAll("#ruler .tick")]
        .find((row) => (row as HTMLElement).style.getPropertyValue("--axis-px") === String(axisPx));
    assert.ok(tick, `no ruler tick was drawn at ${axisPx}px`);
    (tick as HTMLElement).click();
}

// A bubble's identity is its file NAME, never its position — an off-by-one in the stage-1 search
// must not pass because the right index happened to be picked.
function readBubbleName(bubble: HTMLElement): string | null | undefined {
    return bubble.querySelector(".fname")?.textContent;
}

test("test_clicking_a_shared_tick_centers_the_bubble_that_begins_there", async () => {
    // Scenario (task 260, stage 1): two bubbles touch the same instant — one merely has an interior
    // commit node on it, the other BEGINS on it. The user's rule picks the one that begins there.
    // Steps:
    // draw both pairs and start recording scroll requests.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    // click the shared instant's ruler row.
    clickRulerTickAt(SHARED_PX);
    // exactly one scroll, aimed at the bubble that BEGINS there — not at the earlier-drawn bubble
    // that merely holds a node on it, which is what a one-stage search would have returned.
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "beginning.ts");
    // task 277: the bubble's TOP is aligned, not its middle — a bubble is as tall as its own ladder
    // span, so centring one vertically puts its name and first node above the pane. Horizontally it
    // is still centred, because the canvas is oversized sideways too.
    assert.deepEqual(requests[0]!.options, { block: "start", inline: "center" });
});

test("test_clicking_a_tick_no_bubble_begins_at_centers_the_bubble_holding_that_node", async () => {
    // Scenario (task 260, stage 2 — the user's words): "if no bubble starts there, scroll to the
    // node at that timestamp". HELD_PX carries the first pair's on-disk node and nothing begins on
    // it, so the fallback is the only thing that can answer this click.
    // Steps:
    // draw both pairs and start recording scroll requests.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    // click a ruler row no bubble begins at.
    clickRulerTickAt(HELD_PX);
    // the bubble CONTAINING the node at that instant is centered — node offsets are widget-relative,
    // so this only resolves if the lookup adds the bubble's own base offset back on.
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "spanning.ts");
});

test("test_every_drawn_ruler_row_is_clickable", async () => {
    // Scenario (task 260): the ruler becomes a navigation control, so no drawn row may be inert —
    // a reader who clicks one and gets nothing cannot tell the feature from a bug.
    // Steps:
    // draw the view, then click each drawn row in turn against its own recorder.
    await loadPageWithView(buildSharedInstantView());
    for (const axisPx of [EARLY_PX, SHARED_PX, HELD_PX, LATE_PX]) {
        const requests = recordScrollRequests();
        clickRulerTickAt(axisPx);
        assert.equal(requests.length, 1, `ruler row at ${axisPx}px scrolled nothing`);
    }
});
