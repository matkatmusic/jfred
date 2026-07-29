// Task 315: a pair bubble draws one 📸 node per snapshot the wire ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

const COMMIT = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 60 };
const SNAP1 = { instant: "2026-06-04T09:00:00.000Z", axisPx: 90, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl", line: 12 };
const SNAP2 = { instant: "2026-06-05T09:00:00.000Z", axisPx: 120, version: 2, sessionId: "s-2", sessionFile: "beta.jsonl", line: 34 };

// A snapshot the server placed one 22 px row below the on-disk node it shares an instant with.
const TIED_ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 50 };
const TIED_SNAP = { instant: "2026-06-03T09:00:00.000Z", axisPx: 72, version: 3, sessionId: "s-3", sessionFile: "gamma.jsonl", line: 7 };

const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

function viewWithOnePair(pair: object, ...ticks: { instant: string; axisPx: number }[]): object {
    return {
        pairs: [pair],
        gitOrphans: [],
        diskOrphans: [],
        ruler: ticks.map((tick) => ({ instant: tick.instant, axisPx: tick.axisPx, eventCount: 1 })),
    };
}

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

test("test_a_snapshotted_pair_draws_one_camera_node_per_version_at_the_wire_offsets", async () => {
    // Scenario: a pair carrying two snapshots renders a 📸 dot and label per version, each at its own axisPx relative to the widget's earliest node (the commit at 30).
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK, snapshots: [SNAP1, SNAP2] };
    await loadPageWithView(viewWithOnePair(pair, COMMIT, ON_DISK, SNAP1, SNAP2));
    // one snapshot dot per version, placed at axisPx - startPx (startPx is the commit's 30).
    assert.deepEqual(listMatching("#stage .node.n-snap").map(readAxisOffsetPx), [60, 90]);
    // the labels read `@vN 📸`, in wire order.
    assert.deepEqual(listMatching("#stage .nlabel.n-snap").map((label) => label.textContent), ["@v1 📸", "@v2 📸"]);
});

test("test_a_snapshot_node_carries_its_version_session_file_and_line_for_tasks_316_317", async () => {
    // Scenario: tasks 316/317 must act on a snapshot without a second fetch, so the DOM node carries its identity in data- attrs (task 280 rule), on the dot and its label alike.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK, snapshots: [SNAP1] };
    await loadPageWithView(viewWithOnePair(pair, COMMIT, ON_DISK, SNAP1));
    for (const element of listMatching("#stage .n-snap")) {
        assert.equal(element.getAttribute("data-version"), "1");
        assert.equal(element.getAttribute("data-session-file"), "alpha.jsonl");
        assert.equal(element.getAttribute("data-line"), "12");
    }
});

test("test_a_snapshot_free_pair_is_unchanged_from_layer_1", async () => {
    // Scenario: the snapshots key is omitted when empty, so a snapshot-free pair draws no 📸 node and keeps its Layer 1 anchor and span.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK };
    await loadPageWithView(viewWithOnePair(pair, COMMIT, ON_DISK));
    assert.equal(listMatching("#stage .n-snap").length, 0);
    const widget = listMatching("#stage .filebox:not(.bucket)")[0]!;
    assert.equal(readAxisOffsetPx(widget), COMMIT.axisPx);
    assert.equal(listMatching("#stage .lane")[0]!.style.getPropertyValue("--span-px"), String(ON_DISK.axisPx - COMMIT.axisPx));
});

test("test_a_snapshot_sharing_the_on_disk_instant_sits_one_row_apart_inside_a_tie_group", async () => {
    // Scenario (mockup src/index.ts @v3): a snapshot on the on-disk instant takes the tie group's next row slot — its axisPx differs from the disk node's — and the dashed tie-group rectangle is drawn over the run.
    const pair = { path: "src/index.ts", commits: [COMMIT], onDisk: TIED_ON_DISK, snapshots: [TIED_SNAP] };
    await loadPageWithView(viewWithOnePair(pair, COMMIT, TIED_ON_DISK));
    const startPx = COMMIT.axisPx;
    const diskOffset = readAxisOffsetPx(listMatching("#stage .node.n-disk")[0]!);
    const snapOffset = readAxisOffsetPx(listMatching("#stage .node.n-snap")[0]!);
    assert.equal(diskOffset, TIED_ON_DISK.axisPx - startPx);
    assert.equal(snapOffset, TIED_SNAP.axisPx - startPx);
    assert.notEqual(diskOffset, snapOffset);
    // the "same instant" rectangle spans the disk node down to the snapshot.
    const tie = listMatching("#stage .tiegroup")[0]!;
    assert.equal(readAxisOffsetPx(tie), TIED_ON_DISK.axisPx - startPx);
    assert.equal(tie.style.getPropertyValue("--span-px"), String(TIED_SNAP.axisPx - TIED_ON_DISK.axisPx));
});
