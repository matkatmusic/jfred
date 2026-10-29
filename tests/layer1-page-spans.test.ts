// Tasks 247/248/249: a pair widget spans its earliest node to its latest; a negative disk offset drew above.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";

// The on-disk state sits BEFORE both commits (inverted case); hashes are real 40-character values so truncation bugs show.
const DISK_FIRST_ON_DISK = { instant: "2026-06-01T09:00:00.000Z", axisPx: 10 };
const DISK_FIRST_COMMITS = [
    { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 24 },
    { hash: "c8d9e0f1a2b34556677889900aabbccddeeff112", instant: "2026-06-03T09:00:00.000Z", axisPx: 38 },
];

// One pair whose disk mtime is older than its ladder; orphan buckets stay empty so assertions target one widget.
function buildDiskBeforeCommitsView(): object {
    return {
        pairs: [{ path: "src/stale.ts", commits: DISK_FIRST_COMMITS, onDisk: DISK_FIRST_ON_DISK }],
        gitOrphans: [],
        diskOrphans: [],
        // Each instant has exactly one node, so every ruler entry counts one event (task 275).
        ruler: [DISK_FIRST_ON_DISK, ...DISK_FIRST_COMMITS].map((tick) => ({ ...tick, eventCount: 1 })),
    };
}

const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// Boot a fresh page on a stubbed stream ending in `view`; initLayer1Page runs explicitly because boot runs once.
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

test("test_a_widget_pins_to_its_earliest_node_when_the_disk_state_predates_its_commits", async () => {
    // Scenario (tasks 247-249): the anchor is the earliest of ALL nodes, so none sits above the bubble's top edge.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // the widget pins to the ON-DISK offset, because that is the earliest instant it draws.
    const widget = listMatching("#stage .filebox:not(.bucket)")[0]!;
    assert.equal(readAxisOffsetPx(widget), DISK_FIRST_ON_DISK.axisPx);
});

test("test_no_node_in_a_widget_is_placed_at_a_negative_offset", async () => {
    // Scenario (tasks 247-249): no node may carry a negative offset, which is what the old anchor failed.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // every node, of either kind, sits at or after the lane's top.
    const offsets = listMatching("#stage .node").map(readAxisOffsetPx);
    assert.deepEqual(offsets.filter((offset) => offset < 0), []);
    // and the disk node specifically is at the lane top, since it is the earliest instant.
    assert.deepEqual(listMatching("#stage .node.n-disk").map(readAxisOffsetPx), [0]);
});

test("test_a_widgets_lane_spans_to_its_latest_node_when_that_node_is_a_commit", async () => {
    // Scenario (tasks 247-249): when the LAST node is a commit, the lane must still contain its whole ladder.
    await loadPageWithView(buildDiskBeforeCommitsView());
    // the lane reaches the last commit, measured from the widget's own anchor.
    const lane = listMatching("#stage .lane")[0]!;
    const expectedSpan = DISK_FIRST_COMMITS[1]!.axisPx - DISK_FIRST_ON_DISK.axisPx;
    assert.equal(lane.style.getPropertyValue("--span-px"), String(expectedSpan));
});
