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

// Both pairs on one ruler. `ruler` is ascending, as the endpoint emits it. Every entry carries task
// 275's event count because the gutter refuses to draw one without it; the numbers are the real
// tallies (the shared instant is drawn by both bubbles), though nothing here asserts on them.
function buildSharedInstantView(): object {
    return {
        pairs: [SPANNING_PAIR, BEGINNING_PAIR],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [
            { ...AT_EARLY, eventCount: 1 },
            { ...AT_SHARED, eventCount: 2 },
            { ...AT_HELD, eventCount: 1 },
            { ...AT_LATE, eventCount: 1 },
        ],
    };
}

// A view whose ONLY record is a two-row disk-orphan bucket. A bucket draws no `.node`, so before
// task 266 the second row's instant had nothing the click lookup could see.
const BUCKET_FIRST = { path: "notes.txt", instant: "2026-06-20T09:00:00.000Z", axisPx: 200 };
const BUCKET_SECOND = { path: "scratch.txt", instant: "2026-06-22T09:00:00.000Z", axisPx: 240 };

function buildBucketOnlyView(): object {
    return {
        pairs: [],
        gitOrphans: [],
        diskOrphans: [BUCKET_FIRST, BUCKET_SECOND],
        ruler: [{ ...BUCKET_FIRST, eventCount: 1 }, { ...BUCKET_SECOND, eventCount: 1 }],
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
// must not pass because the right index happened to be picked. The scroll target may be a ROW
// INSIDE a bubble rather than the bubble itself (task 266), so the name is read off whichever
// `.filebox` encloses it.
function readBubbleName(target: HTMLElement): string | null | undefined {
    return target.closest(".filebox")?.querySelector(".fname")?.textContent;
}

// The widget-relative offset an element was drawn at — the value the click lookup matches on.
function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
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
    // task 266: the row the reader clicked is already on screen, so the jump must not move it
    // vertically at all — `nearest` scrolls only if the target is out of view. Horizontally it is
    // centred, because the stage is oversized sideways and that IS the jump.
    assert.deepEqual(requests[0]!.options, { block: "nearest", inline: "center" });
});

test("test_clicking_a_tick_no_bubble_begins_at_scrolls_to_the_row_at_that_instant", async () => {
    // Scenario (task 260, stage 2 — the user's words): "if no bubble starts there, scroll to the
    // node at that timestamp". HELD_PX carries the first pair's on-disk node and nothing begins on
    // it, so the fallback is the only thing that can answer this click.
    // Steps:
    // draw both pairs and start recording scroll requests.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    // click a ruler row no bubble begins at.
    clickRulerTickAt(HELD_PX);
    // the bubble CONTAINING the node at that instant is brought across — node offsets are
    // widget-relative, so this only resolves if the lookup adds the bubble's own base offset back on.
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "spanning.ts");
});

test("test_a_stage_two_click_targets_the_clicked_row_and_not_the_bubbles_top", async () => {
    // Scenario (task 266): the reported bug. spanning.ts BEGINS at EARLY_PX but holds the clicked
    // instant at HELD_PX, 80 px further down its ladder. Handing scrollIntoView the BUBBLE aligns
    // whatever block option is in force against EARLY_PX — which over the real render put the
    // clicked row a median 1,870 px outside the pane. The target must be the row at HELD_PX itself,
    // and the scroll must not move it vertically.
    // Steps:
    // draw both pairs and click the row only spanning.ts's on-disk node stands on.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    clickRulerTickAt(HELD_PX);
    // the target is a NODE inside the bubble, not the `.filebox` — the thing actually drawn at the
    // clicked instant.
    const target = requests[0]!.target;
    assert.ok(target.classList.contains("node"), `scrolled a ${target.className} rather than a node`);
    // and it is the node whose absolute offset IS the clicked instant: its own widget-relative
    // offset plus its bubble's base. A bubble-shaped target would read EARLY_PX here instead.
    const bubblePx = readAxisPx(target.closest(".filebox") as HTMLElement);
    assert.equal(bubblePx, EARLY_PX);
    assert.equal(bubblePx + readAxisPx(target), HELD_PX);
    // vertically nothing is forced, so the row the reader clicked stays where it was.
    assert.deepEqual(requests[0]!.options, { block: "nearest", inline: "center" });
});

test("test_a_ruler_row_only_an_orphan_bucket_holds_is_still_clickable", async () => {
    // Scenario (task 266): a bucket renders a `ul`/`li` list and no `.node`, so stage 2 was blind to
    // every bucket row except the earliest — which stage 1 catches only because it is the bucket's
    // own `--axis-px`. Over the real render two ruler rows resolved to nothing at all and answered a
    // click in silence, which is indistinguishable from the feature being broken.
    // Steps:
    // draw a view whose only records are two disk orphans, and click the LATER one's row.
    await loadPageWithView(buildBucketOnlyView());
    const requests = recordScrollRequests();
    clickRulerTickAt(BUCKET_SECOND.axisPx);
    // the bucket holding that row was asked to scroll — the row itself, inside it.
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "No repository match");
    assert.equal(requests[0]!.target.tagName, "LI");
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
