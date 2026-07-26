// Tasks 247/248/249: a pair widget must span from its EARLIEST node instant to its LATEST,
// whichever KIND each of those happens to be. Split from tests/layer1-page.test.ts, which is at
// the 250-line cap; that file covers what a widget renders, this one covers how far it reaches.
//
// The bug these pin: `startPx` was `pair.commits[0].axisPx` unconditionally, so a file whose
// on-disk mtime PREDATES its first commit produced a negative `onDisk.axisPx - startPx`. The disk
// node is absolutely positioned in the lane with `translate(-50%, -50%)`, so a negative offset drew
// it above the lane's top — over the widget's own filename/sub header, or clear outside the bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

// The pair's on-disk state, placed BEFORE either commit — the inverted case. A real 40-character
// hash, matching tests/layer1-page.test.ts: a short fake would pass a broken truncation unchanged.
const DISK_FIRST_ON_DISK = { instant: "2026-06-01T09:00:00.000Z", axisPx: 10 };
const DISK_FIRST_COMMITS = [
    { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 24 },
    { hash: "c8d9e0f1a2b34556677889900aabbccddeeff112", instant: "2026-06-03T09:00:00.000Z", axisPx: 38 },
];

// One pair whose disk mtime is older than its whole ladder, and nothing else — the two orphan
// buckets stay empty so every assertion below is about the one widget.
function buildDiskBeforeCommitsView(): object {
    return {
        pairs: [{ path: "src/stale.ts", commits: DISK_FIRST_COMMITS, onDisk: DISK_FIRST_ON_DISK }],
        gitOrphans: [],
        diskOrphans: [],
        // Each instant is drawn by exactly one of this pair's nodes, so every ruler entry counts
        // one event (task 275 — the gutter prints it, nothing here reads it back).
        ruler: [DISK_FIRST_ON_DISK, ...DISK_FIRST_COMMITS].map((tick) => ({ ...tick, eventCount: 1 })),
    };
}

const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// Boot a fresh page against a stubbed NDJSON stream whose terminal line is `view`, exactly as
// tests/layer1-page.test.ts does — bootLayer1Page is called explicitly because node's module cache
// runs the module's own boot line only on the first import.
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

test("test_a_widget_pins_to_its_earliest_node_when_the_disk_state_predates_its_commits", async () => {
    // Scenario (tasks 247-249): the widget's anchor is the earliest of ALL its nodes, not its first
    // commit, so the bubble's top edge still lands on a real ruler tick and no node sits above it.
    // Steps:
    // load the inverted view, whose on-disk instant is older than both commits.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // the widget pins to the ON-DISK offset, because that is the earliest instant it draws.
    const widget = listMatching("#stage .filebox:not(.bucket)")[0]!;
    assert.equal(readAxisOffsetPx(widget), DISK_FIRST_ON_DISK.axisPx);
});

test("test_no_node_in_a_widget_is_placed_at_a_negative_offset", async () => {
    // Scenario (tasks 247-249): a negative offset is what drew the disk node above the lane and over
    // the header, so NO node may carry one — this is the assertion the old anchor failed.
    // Steps:
    // load the inverted view.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // every node, of either kind, sits at or after the lane's top.
    const offsets = listMatching("#stage .node").map(readAxisOffsetPx);
    assert.deepEqual(offsets.filter((offset) => offset < 0), []);
    // and the disk node specifically is at the lane top, since it is the earliest instant.
    assert.deepEqual(listMatching("#stage .node.n-disk").map(readAxisOffsetPx), [0]);
});

test("test_a_widgets_lane_spans_to_its_latest_node_when_that_node_is_a_commit", async () => {
    // Scenario (tasks 247-249): the span was hardcoded to the on-disk node, so when the LAST node is
    // a commit instead, the lane was too short to contain its own ladder.
    // Steps:
    // load the inverted view, whose latest instant is its second commit.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // the lane reaches the last commit, measured from the widget's own anchor.
    const lane = listMatching("#stage .lane")[0]!;
    const expectedSpan = DISK_FIRST_COMMITS[1]!.axisPx - DISK_FIRST_ON_DISK.axisPx;
    assert.equal(lane.style.getPropertyValue("--span-px"), String(expectedSpan));
});
