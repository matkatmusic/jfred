// Task 290, second half (user, 2026-07-26): "when you mouse over a leader line and the node(s) or bubble(s) it is pointing to is/are in the visible part of the timeline, highlight those nodes and make the dashed leader line's color change to the same highlight color used for nodes and bubbles."
//
// What is asserted is the `aimed` CLASS. layer1-styles.css is what recolours the dashes and marks the targets from it, so the class IS this module's contract — happy-dom implements no cascade, and a measured colour would be measuring happy-dom (same reasoning as tests/layer1-ruler-click.test.ts).
//
// happy-dom also implements no LAYOUT, so getBoundingClientRect answers an all-zero rect for every element and the visibility gate would say false for everything — the feature is unobservable without a stub. Every test here patches that prototype method AFTER booting, exactly as tests/layer1-ruler-click.test.ts patches scrollIntoView, because setupLayer1Dom builds a FRESH window per test and an earlier window's prototype is not the one this page's elements use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

// One placed moment as the endpoint ships it: absolute ruler offsets, no time arithmetic anywhere.
interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// SHARED_PX is the crux: the second bubble BEGINS there while the first merely holds an interior commit node on it, so a leader hovered there must light BOTH kinds of target. Every offset is >= the page's 13 px tick-label collision threshold from its neighbour, so no ruler entry is dropped.
const EARLY_PX = 10;
const SHARED_PX = 40;
const LATE_PX = 110;

const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// REAL 40-character hashes, as tests/layer1-page.test.ts uses: the page shortens the label, and a 7-character fake would let a broken truncation through unnoticed.
const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";

// Drawn FIRST, and it begins EARLIER: the shared instant is only an interior node of this one.
const SPANNING_PAIR = {
    path: "src/spanning.ts",
    commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Drawn SECOND, and it BEGINS on the shared instant — so the hover's target set has to hold a `.filebox` as well as the node above it.
const BEGINNING_PAIR = {
    path: "src/beginning.ts",
    commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Both pairs on one ruler. Every entry carries task 275's event count because the gutter refuses to draw a row without it; one leader line is drawn per ENTRY, which is what this file hovers.
function buildSharedInstantView(): object {
    return {
        pairs: [SPANNING_PAIR, BEGINNING_PAIR],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [
            { ...AT_EARLY, eventCount: 1 },
            { ...AT_SHARED, eventCount: 2 },
            { ...AT_LATE, eventCount: 2 },
        ],
    };
}

// Only the four edges are read, so a plain box is enough — happy-dom never constructs a real DOMRect here because it has no layout to construct one from.
function makeRect(left: number, top: number, right: number, bottom: number): DOMRect {
    return { left, top, right, bottom, width: right - left, height: bottom - top } as unknown as DOMRect;
}

// One box every element shares, and one the PANE alone gets: disjoint vertically, which is the scrolled-away case — the targets are still in the document, just outside the visible scrollport.
const ON_SCREEN = makeRect(0, 0, 900, 600);
const SCROLLED_PAST_TARGETS = makeRect(0, 2000, 900, 2600);

function stubEveryRectOnScreen(): void {
    HTMLElement.prototype.getBoundingClientRect = () => ON_SCREEN;
}

function stubPaneScrolledAwayFromTargets(): void {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        return this.id === "timelines" ? SCROLLED_PAST_TARGETS : ON_SCREEN;
    };
}

// Set up a fresh page at a deep link naming both roots, stub the endpoint's NDJSON stream with the view as its terminal line, and boot. bootLayer1Page is called EXPLICITLY: node's module cache runs the module's own boot line only on the first import, so later tests would render nothing.
async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

// The dashed line drawn for one absolute offset. Fails loudly rather than returning undefined: a test aimed at a line the render never produced is testing nothing.
function findLeaderAt(axisPx: number): HTMLElement {
    const leader = [...document.querySelectorAll<HTMLElement>("#leaders .leader")]
        .find((line) => line.style.getPropertyValue("--axis-px") === String(axisPx));
    assert.ok(leader, `no leader line was drawn at ${axisPx}px`);
    return leader;
}

function listAimedElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".aimed")];
}

// The widget-relative offset an element was drawn at — the value the target lookup matches on.
function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_hovering_a_leader_line_highlights_every_visible_target_at_its_instant", async () => {
    // Scenario (task 290, the user's words): "I cannot visually tell what the dashed leader lines are actually pointing at when they intersect with a bubble or node." A leader marks the DOTS it points at — the nodes drawn at its instant, in EVERY bubble that touches it, whether that bubble begins there or merely holds it. Never the bubble's box: a lit box does not say which instant it means, which is the same complaint the ruler-tick click was fixed for on 2026-07-26.  Steps: draw both pairs, then put every box on screen so the visibility gate can pass.
    await loadPageWithView(buildSharedInstantView());
    stubEveryRectOnScreen();
    // mouse onto the line at the instant beginning.ts begins at and spanning.ts holds a commit on.
    findLeaderAt(SHARED_PX).dispatchEvent(new window.Event("pointerenter"));
    // the line itself is recoloured...
    assert.ok(findLeaderAt(SHARED_PX).classList.contains("aimed"), "the hovered line was not recoloured");
    // ...no bubble is marked, only dots...
    assert.equal(document.querySelector(".filebox.aimed"), null, "a bubble was marked instead of a dot");
    // ...and BOTH dots at that instant are: beginning.ts's first node and the interior node spanning.ts merely holds there. A node's own --axis-px is widget-relative, so each of these resolves to the hovered instant only if its bubble's base offset is added back on.
    const litNodes = [...document.querySelectorAll<HTMLElement>(".node.aimed")];
    const names = litNodes.map((node) => node.closest(".filebox")?.querySelector(".fname")?.textContent);
    // sorted, because WHICH bubble is drawn first is a render detail and not this module's promise.
    assert.deepEqual(names.sort(), ["beginning.ts", "spanning.ts"]);
    for (const node of litNodes) {
        assert.equal(readAxisPx(node.closest(".filebox") as HTMLElement) + readAxisPx(node), SHARED_PX);
    }
});

test("test_leaving_a_leader_line_drops_the_highlight", async () => {
    // Scenario (task 290): this is a HOVER state over MANY elements, not tasks 283/267's single persistent selection — so leaving must darken everything entering lit, or the page would accumulate one lit set per line the pointer ever crossed.  Steps: draw both pairs, put every box on screen, and hover the shared instant's line.
    await loadPageWithView(buildSharedInstantView());
    stubEveryRectOnScreen();
    const leader = findLeaderAt(SHARED_PX);
    leader.dispatchEvent(new window.Event("pointerenter"));
    assert.ok(listAimedElements().length > 0, "nothing was highlighted to begin with");
    // mouse off it again.
    leader.dispatchEvent(new window.Event("pointerleave"));
    // nothing anywhere on the page is still marked, the line included.
    assert.deepEqual(listAimedElements(), []);
});

test("test_a_leader_whose_targets_are_scrolled_away_stays_unhighlighted", async () => {
    // Scenario (task 290, the user's condition): the recolour is promised only "when the node(s) or bubble(s) it is pointing to is/are in the visible part of the timeline". A line whose targets have scrolled out of the pane must stay grey rather than advertise a target the reader cannot find on screen.  Steps: draw both pairs, then move the PANE's box clear of every target's box.
    await loadPageWithView(buildSharedInstantView());
    stubPaneScrolledAwayFromTargets();
    // hover the line whose two targets are now outside the scrollport.
    findLeaderAt(SHARED_PX).dispatchEvent(new window.Event("pointerenter"));
    // nothing is marked — not the targets, and not the hovered line either.
    assert.deepEqual(listAimedElements(), []);
});
