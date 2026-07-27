// The dashed leader lines are drawn ON DEMAND (user, 2026-07-26): "I am curious to see what the
// timeline looks like if dashed leader lines are only drawn when the user mouses over a ruler
// timestamp, [or] mouses over or selects a bubble [or] a node. For all other scroll events in the
// timeline, no dashed lines should be drawn."
//
// What is asserted is the `shown` CLASS, exactly as tests/layer1-leader-hover.test.ts asserts
// `aimed`: layer1-styles.css is what turns the class into an opacity, happy-dom implements no
// cascade, and a measured opacity would be measuring happy-dom rather than the page.
//
// No getBoundingClientRect stub is needed here — unlike the `aimed` hover, showing a line has no
// visibility gate, so this behaviour is fully observable without layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// SHARED_PX is the crux, the same one the sibling hover test uses: the second bubble BEGINS there
// while the first merely holds an interior commit node on it. So "hover the node" and "hover the
// bubble" are DIFFERENT offsets on the first bubble and the SAME one on the second, which is what
// catches a lookup that forgot to add a widget-relative offset back onto its bubble's base.
const EARLY_PX = 10;
const SHARED_PX = 40;
const LATE_PX = 110;

const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// REAL 40-character hashes: the page shortens the visible label, and a 7-character fake would let a
// broken truncation through unnoticed.
const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";

// Begins EARLY and holds an interior node on the shared instant.
const SPANNING_PAIR = {
    path: "src/spanning.ts",
    commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Begins ON the shared instant.
const BEGINNING_PAIR = {
    path: "src/beginning.ts",
    commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

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

async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

// The offsets of the lines currently DRAWN, which is the whole assertion surface here.
function listShownLeaderOffsets(): number[] {
    return [...document.querySelectorAll<HTMLElement>("#leaders .leader.shown")]
        .map((leader) => Number(leader.style.getPropertyValue("--axis-px")));
}

function findBubble(basename: string): HTMLElement {
    const name = [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")]
        .find((element) => element.textContent === basename);
    assert.ok(name, `no bubble named ${basename} was drawn`);
    return name.closest(".filebox") as HTMLElement;
}

function findTickAt(axisPx: number): HTMLElement {
    const tick = [...document.querySelectorAll<HTMLElement>("#ruler .tick")]
        .find((element) => element.style.getPropertyValue("--axis-px") === String(axisPx));
    assert.ok(tick, `no ruler tick was drawn at ${axisPx}px`);
    return tick;
}

// Drive the hover the way the delegated listener sees it, rather than calling the resolver: the
// listener is wired to the PANE, so a bubbling event is what proves the wiring as well as the
// lookup.
function hover(element: Element | undefined): void {
    if (element === undefined) {
        document.getElementById("timelines")?.dispatchEvent(new window.Event("pointerleave"));
        return;
    }
    element.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
}

test("test_no_leader_line_is_drawn_until_something_asks_for_one", async () => {
    // Scenario (the user's rule): "for all other scroll events in the timeline, no dashed lines
    // should be drawn". A freshly rendered stage has had no hover and no selection, so the rest
    // state must be empty — this is the assertion the whole change exists for.
    // Steps:
    // render two pairs over a three-entry ruler.
    await loadPageWithView(buildSharedInstantView());
    // every line the page needs is in the DOM...
    assert.equal(document.querySelectorAll("#leaders .leader").length, 3);
    // ...and not one of them is drawn.
    assert.deepEqual(listShownLeaderOffsets(), []);
});

test("test_hovering_a_ruler_timestamp_draws_that_row_s_line", async () => {
    // Scenario: the first of the three sources the user named — "the user mouses over a ruler
    // timestamp". A tick carries the ABSOLUTE offset, so this is the direct case.
    // Steps:
    // render, then mouse onto the gutter row for the shared instant.
    await loadPageWithView(buildSharedInstantView());
    hover(findTickAt(SHARED_PX));
    // exactly its own line is up, not the neighbouring rows'.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
    // mousing off the pane entirely puts it away again.
    hover(undefined);
    assert.deepEqual(listShownLeaderOffsets(), []);
});

test("test_hovering_a_bubble_draws_the_line_for_the_instant_it_begins_at", async () => {
    // Scenario: "mouses over ... a bubble". A bubble's own --axis-px is its FIRST node's offset, so
    // hovering its header must draw the line for where it begins — EARLY_PX for the spanning pair,
    // even though that same bubble also holds a node on the shared instant.
    // Steps:
    // render, then mouse onto the spanning bubble's name.
    await loadPageWithView(buildSharedInstantView());
    hover(findBubble("spanning.ts").querySelector(".fname") ?? undefined);
    assert.deepEqual(listShownLeaderOffsets(), [EARLY_PX]);
});

test("test_hovering_an_interior_node_draws_that_node_s_line_not_its_bubble_s", async () => {
    // Scenario: "mouses over ... a node" — and the case that catches the arithmetic. A node's
    // --axis-px is WIDGET-RELATIVE, so the spanning bubble's second node reads 30 while the line it
    // belongs to is at 40; only adding the bubble's own base back on resolves it.
    // Steps:
    // render, then mouse onto the second node of the bubble that BEGINS 30px earlier.
    await loadPageWithView(buildSharedInstantView());
    const interiorNode = findBubble("spanning.ts").querySelectorAll<HTMLElement>(".node")[1];
    assert.ok(interiorNode, "the spanning bubble drew no second node");
    assert.equal(Number(interiorNode.style.getPropertyValue("--axis-px")), SHARED_PX - EARLY_PX);
    hover(interiorNode);
    // the SHARED line, not the bubble's own EARLY one.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
});

test("test_a_landed_selection_keeps_its_line_up_after_the_pointer_moves_away", async () => {
    // Scenario: "or selects a bubble [or] a node". A landing — the find box, a File Nav leaf or a
    // ruler-tick click, all of which funnel through highlightLandedElement — is a SELECTION, so its
    // line has to outlive the pointer that is no longer anywhere near it.
    // Steps:
    // render, then land on the bubble that begins at the shared instant, as the find box would.
    await loadPageWithView(buildSharedInstantView());
    const { highlightLandedElement } = await import("../webapp/layer1-find-file.ts");
    highlightLandedElement(findBubble("beginning.ts"));
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
    // mouse over an unrelated row and away again: the hover's line comes and goes...
    hover(findTickAt(LATE_PX));
    assert.deepEqual(listShownLeaderOffsets().sort((a, b) => a - b), [SHARED_PX, LATE_PX]);
    hover(undefined);
    // ...and the selection's line is still there.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
});
