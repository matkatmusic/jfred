// Task 264: the dashed leader line belongs to the RULER ENTRY, not to the bubble. Split from tests/layer1-page.test.ts, which is at the 250-line cap — same reason tests/layer1-page-spans.ts was split off before it.
//
// The bug these pin: the leader used to be `.filebox::before`, so it was drawn once per BUBBLE.  Bubbles sharing a start instant each painted their own overlapping copy, and once the line had to be long enough to reach the sticky gutter from anywhere on the canvas (task 262 round two), 805 copies of a 500,000 px dashed border made the page unusably slow (task 263). One line per ruler entry, spanning the canvas behind everything, is both the correctness fix the user asked for and the performance fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

// `eventCount` is task 275's per-instant count. Not optional: layer1-ruler-rows.ts refuses a ruler entry without one (the count is printed in every row), so a fixture missing it fails the whole load with "ruler entry ... carries no event count" and the page draws nothing at all.
interface FixtureInstant {
    instant: string;
    axisPx: number;
    eventCount: number;
}

// Three instants whose MIDDLE label is dropped by renderRulerTicks' 13 px overprint skip: 4 px is closer to 0 than the gap allows, while 14 px clears it. The skip is what makes this fixture worth having — a leader must survive it even though a label does not.  The counts match the two pairs below: both begin at 0 and both end on disk at 14.
const CROWDED_RULER: FixtureInstant[] = [
    { instant: "2026-06-01T09:00:00.000Z", axisPx: 0, eventCount: 2 },
    { instant: "2026-06-01T10:36:00.000Z", axisPx: 4, eventCount: 1 },
    { instant: "2026-06-01T14:36:00.000Z", axisPx: 14, eventCount: 2 },
];

// TWO pairs anchored on the SAME instant, which is the case the user reported: before task 264 this drew two overlapping leaders at one offset. Real 40-character hashes, matching the sibling files — a short fake would pass a broken truncation unchanged.
function buildSharedInstantView(ruler: FixtureInstant[]): object {
    const onDisk = ruler[2]!;
    const commit = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", ...ruler[0]! };
    return {
        pairs: [
            { path: "src/alpha.ts", commits: [commit], onDisk },
            { path: "src/beta.ts", commits: [commit], onDisk },
        ],
        gitOrphans: [],
        diskOrphans: [],
        ruler,
    };
}

const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

async function loadPageWithView(view: object): Promise<void> {
    setupLayer1Dom(BOTH_ROOTS_SEARCH);
    stubStreamRoute("/api/layer1-view", [view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

function listMatching(selector: string): HTMLElement[] {
    return [...document.querySelectorAll(selector)] as HTMLElement[];
}

function readAxisOffsetPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_two_bubbles_sharing_one_instant_share_a_single_leader_line", async () => {
    // Scenario (task 264, user's words): "there should be at most one dashed line for every entry in the ruler, regardless of how many timeline bubbles that start at that timestamp".  Steps: load two pairs that BOTH begin at the 0 px instant.
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    assert.equal(listMatching("#stage .filebox").length, 2);
    // one leader per RULER ENTRY — three, not one per bubble and not two at the shared instant.
    assert.deepEqual(listMatching("#leaders .leader").map(readAxisOffsetPx), [0, 4, 14]);
});

test("test_a_leader_is_drawn_even_where_the_tick_label_was_skipped", async () => {
    // Scenario (task 264): the overprint skip drops a LABEL, not an instant. Bubbles still sit on a skipped instant, so dropping its leader too would leave them with no connector to the gutter.  Steps: the same crowded ruler, whose middle label does not survive.
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    // two labels drawn, but three leaders — the counts are deliberately allowed to disagree.
    assert.equal(listMatching("#ruler .tick").length, 2);
    assert.equal(listMatching("#leaders .leader").length, 3);
});

test("test_no_leader_is_drawn_inside_a_bubble", async () => {
    // Scenario (task 263): the performance fix is structural — nothing per-bubble may draw a leader any more, or the 805-overlapping-copies cost comes straight back. The leaders live in their own container OUTSIDE the stage, which is also what lets them span the sticky ruler gutter (they are positioned against `.canvas`, whereas `.stage` begins to the RIGHT of the gutter).  Steps:
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    assert.equal(listMatching("#stage .leader").length, 0);
    assert.equal(listMatching("#leaders .leader").length, 3);
});
