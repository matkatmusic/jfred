// Task 264: the dashed leader belongs to the RULER ENTRY, not the bubble. Per-bubble copies made the page slow.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";

// `eventCount` is task 275's per-instant count. It is required: layer1-ruler-rows.ts rejects an entry without it.
interface FixtureInstant {
    instant: string;
    axisPx: number;
    eventCount: number;
}

// Three instants whose MIDDLE label renderRulerTicks drops (13 px skip). A leader must survive that skip.
const CROWDED_RULER: FixtureInstant[] = [
    { instant: "2026-06-01T09:00:00.000Z", axisPx: 0, eventCount: 2 },
    { instant: "2026-06-01T10:36:00.000Z", axisPx: 4, eventCount: 1 },
    { instant: "2026-06-01T14:36:00.000Z", axisPx: 14, eventCount: 2 },
];

// TWO pairs on the SAME instant, the reported case: before task 264 they drew two leaders. Hashes are real.
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
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    installStreamRoute("/api/layer1-view", [view]);
    const { initLayer1Page } = await import("../webapp/layer1-page.ts");
    initLayer1Page();
    await waitForAsyncWork();
}

function listMatching(selector: string): HTMLElement[] {
    return [...document.querySelectorAll(selector)] as HTMLElement[];
}

function readAxisOffsetPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_two_bubbles_sharing_one_instant_share_a_single_leader_line", async () => {
    // Scenario (task 264): at most one dashed line per ruler entry, however many bubbles start there.
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    assert.equal(listMatching("#stage .filebox").length, 2);
    // one leader per RULER ENTRY — three, not one per bubble and not two at the shared instant.
    assert.deepEqual(listMatching("#leaders .leader").map(readAxisOffsetPx), [0, 4, 14]);
});

test("test_a_leader_is_drawn_even_where_the_tick_label_was_skipped", async () => {
    // Scenario (task 264): the overprint skip drops a LABEL, not an instant, so bubbles there keep their leader.
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    // two labels drawn, but three leaders — the counts are deliberately allowed to disagree.
    assert.equal(listMatching("#ruler .tick").length, 2);
    assert.equal(listMatching("#leaders .leader").length, 3);
});

test("test_no_leader_is_drawn_inside_a_bubble", async () => {
    // Scenario (task 263): no bubble draws a leader. Leaders live in their own container outside the stage, against `.canvas`.
    await loadPageWithView(buildSharedInstantView(CROWDED_RULER));
    assert.equal(listMatching("#stage .leader").length, 0);
    assert.equal(listMatching("#leaders .leader").length, 3);
});
