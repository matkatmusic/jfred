// Invariant: the bubble that BEGINS at a shared instant wins, and the target is the ROW.

// The fixture draws the merely-holding bubble first, so a document-order search picks wrong.

// happy-dom has no layout, so these assert which element reached scrollIntoView.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// Offsets stay >= the page's 13 px label-collision threshold apart so all four ticks are drawn.
const EARLY_PX = 10;
const SHARED_PX = 40;
const HELD_PX = 90;
const LATE_PX = 110;

const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_HELD: FixtureInstant = { instant: "2026-06-09T09:00:00.000Z", axisPx: HELD_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// Real 40-character hashes: a short fake would let broken label truncation through unnoticed.
const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";
const LATE_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736";

// Drawn FIRST, and the only thing standing on HELD_PX — the trap for a document-order search.
const SPANNING_PAIR = {
    path: "src/spanning.ts",
    commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_HELD,
};

// Drawn SECOND but BEGINS on the shared instant, so stage 1 must still pick it.
const BEGINNING_PAIR = {
    path: "src/beginning.ts",
    commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Every entry carries an event count because the gutter refuses to draw a row without one.
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

// A view whose only records are a disk-orphan bucket — no `.node` anywhere on the stage.
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

interface ScrollRequest { target: HTMLElement; options: unknown }

// Must be installed AFTER booting: setupLayer1Dom builds a fresh window, so an earlier patch records nothing.
function recordScrollRequests(): ScrollRequest[] {
    const requests: ScrollRequest[] = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: unknown): void {
        requests.push({ target: this, options });
    };
    return requests;
}

// bootLayer1Page is called explicitly: node's module cache runs the module's boot line only on first import.
async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

// Fails loudly: a tick the collision skip dropped has no row, and a test aimed at it tests nothing.
function clickRulerTickAt(axisPx: number): void {
    const tick = [...document.querySelectorAll("#ruler .tick")]
        .find((row) => (row as HTMLElement).style.getPropertyValue("--axis-px") === String(axisPx));
    assert.ok(tick, `no ruler tick was drawn at ${axisPx}px`);
    (tick as HTMLElement).click();
}

// The scroll target may be a row inside a bubble, so the name is read off its enclosing `.filebox`.
function readBubbleName(target: HTMLElement): string | null | undefined {
    return target.closest(".filebox")?.querySelector(".fname")?.textContent;
}

function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

function readExpandedNames(): string[] {
    return [...document.querySelectorAll(".tickfiles button")].map((button) => button.textContent ?? "");
}

test("test_clicking_a_shared_tick_selects_the_node_of_the_bubble_that_begins_there", async () => {
    // A shared instant does not guess: the row expands into both names, begins-here first.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    clickRulerTickAt(SHARED_PX);
    assert.equal(requests.length, 0);
    const shortHash = SHARED_HASH.slice(0, 8);
    assert.deepEqual(readExpandedNames(), [`beginning.ts  ${shortHash}`, `spanning.ts  ${shortHash}`]);
    (document.querySelector(".tickfiles button") as HTMLElement).click();
    assert.equal(requests.length, 1);
    const target = requests[0]!.target;
    assert.equal(readBubbleName(target), "beginning.ts");
    assert.ok(target.classList.contains("node"), `scrolled a ${target.className} rather than a node`);
    // `nearest` leaves the already-visible row where it is; `inline: "center"` is the jump.
    assert.deepEqual(requests[0]!.options, { block: "nearest", inline: "center" });
});

test("test_clicking_a_tick_no_bubble_begins_at_scrolls_to_the_row_at_that_instant", async () => {
    // Stage 2 fallback: nothing begins at HELD_PX, so the node standing there must answer.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    clickRulerTickAt(HELD_PX);
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "spanning.ts");
});

test("test_a_stage_two_click_targets_the_clicked_row_and_not_the_bubbles_top", async () => {
    // Regression: scrolling the BUBBLE put the clicked row far outside the pane.
    await loadPageWithView(buildSharedInstantView());
    const requests = recordScrollRequests();
    clickRulerTickAt(HELD_PX);
    const target = requests[0]!.target;
    assert.ok(target.classList.contains("node"), `scrolled a ${target.className} rather than a node`);
    const bubblePx = readAxisPx(target.closest(".filebox") as HTMLElement);
    assert.equal(bubblePx, EARLY_PX);
    assert.equal(bubblePx + readAxisPx(target), HELD_PX);
    assert.deepEqual(requests[0]!.options, { block: "nearest", inline: "center" });
});

test("test_a_ruler_row_only_an_orphan_bucket_holds_is_still_clickable", async () => {
    // Regression: a bucket renders `ul`/`li` and no `.node`, so stage 2 was blind to its rows.
    await loadPageWithView(buildBucketOnlyView());
    const requests = recordScrollRequests();
    clickRulerTickAt(BUCKET_SECOND.axisPx);
    assert.equal(requests.length, 1);
    assert.equal(readBubbleName(requests[0]!.target), "No repository match");
    assert.equal(requests[0]!.target.tagName, "LI");
});

test("test_every_drawn_ruler_row_is_clickable", async () => {
    // No drawn row may be inert: a lone event jumps, a shared one expands into its names.
    await loadPageWithView(buildSharedInstantView());
    for (const axisPx of [EARLY_PX, SHARED_PX, HELD_PX, LATE_PX]) {
        const requests = recordScrollRequests();
        clickRulerTickAt(axisPx);
        const answered = requests.length + readExpandedNames().length;
        assert.ok(answered > 0, `ruler row at ${axisPx}px did nothing at all`);
    }
});

test("test_clicking_a_ruler_tick_highlights_the_element_it_landed_on", async () => {
    // A landing lights the node and its owning bubble; a second click MOVES that light.
    await loadPageWithView(buildSharedInstantView());
    assert.equal(document.querySelector(".found"), null);
    clickRulerTickAt(EARLY_PX);
    assert.equal(readBubbleName(document.querySelector<HTMLElement>(".found")!), "spanning.ts");
    clickRulerTickAt(HELD_PX);
    assert.equal(document.querySelectorAll(".found").length, 2);
    const litNode = document.querySelector<HTMLElement>(".node.found")!;
    const litBubble = litNode.closest(".filebox") as HTMLElement;
    assert.equal(readAxisPx(litBubble) + readAxisPx(litNode), HELD_PX);
    clickRulerTickAt(SHARED_PX);
    (document.querySelector(".tickfiles button") as HTMLElement).click();
    const litRow = document.querySelector<HTMLElement>(".node.found")!;
    assert.equal(readBubbleName(litRow), "beginning.ts");
    assert.ok(litRow.closest(".filebox")!.classList.contains("found"), "the file's bubble is lit too");
});
