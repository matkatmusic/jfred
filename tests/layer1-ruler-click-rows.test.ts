// Ruler rows that hold only orphan-bucket entries, every drawn row staying clickable, and the landing highlight.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

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

const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";

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

interface ScrollRequest { target: HTMLElement }

// A landing measures its target (scrollToUncoveredCentre); the pane and drawer are measured too, so they are skipped. Must be installed AFTER booting: setupLayer1Dom builds a fresh window.
function recordScrollRequests(): ScrollRequest[] {
    const requests: ScrollRequest[] = [];
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        if (this.id !== "timelines" && this.id !== "drawer") {
            requests.push({ target: this });
        }
        return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    };
    return requests;
}

// bootLayer1Page is called explicitly: node's module cache runs the module's boot line only on first import.
async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await waitForAsyncWork();
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
    // Task 300: expanding re-lays-out every offset, so the expanding row is clicked LAST.
    for (const axisPx of [EARLY_PX, HELD_PX, LATE_PX, SHARED_PX]) {
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
