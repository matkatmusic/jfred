// The orphan buckets, the zero-pair message, and the URL query round trip; offsets are stated absolutely.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

interface FixtureInstant {
    instant: string;
    axisPx: number;
}

interface FixtureRulerTick extends FixtureInstant {
    eventCount: number;
}

// Every instant in these fixtures is drawn by exactly ONE node, so each ruler entry counts 1.
function countOneEventAt(entry: FixtureInstant): FixtureRulerTick {
    return { ...entry, eventCount: 1 };
}

interface FixtureCommit extends FixtureInstant {
    hash: string;
}

// REAL 40-character hashes, oldest first: 7-char fakes would pass a broken truncation unchanged.
const PAIR_COMMITS: FixtureCommit[] = [
    { hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", instant: "2026-06-01T09:00:00.000Z", axisPx: 10 },
    { hash: "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5", instant: "2026-06-01T14:30:00.000Z", axisPx: 24 },
];

const PAIR_ON_DISK: FixtureInstant = { instant: "2026-07-24T08:15:00.000Z", axisPx: 66 };

// In the repo at `ref`, absent from disk — the "No on-disk match" bucket's only member.
const GIT_ORPHAN = { path: "docs/old-api.md", instant: "2026-07-20T16:00:00.000Z", axisPx: 38 };

// On disk, absent from the repo — the "No repository match" bucket's only member.
const DISK_ORPHAN = { path: "notes.txt", instant: "2026-07-23T19:40:00.000Z", axisPx: 52 };

// Adjacent offsets sit 14 px apart, clear of the 13 px label-collision threshold, so no tick merge triggers here.
const RULER: FixtureRulerTick[] = [
    PAIR_COMMITS[0]!, PAIR_COMMITS[1]!, GIT_ORPHAN, DISK_ORPHAN, PAIR_ON_DISK,
].map(countOneEventAt);

function buildPartialOverlapView(): object {
    const pair = { path: "src/index.ts", commits: PAIR_COMMITS, onDisk: PAIR_ON_DISK };
    return { pairs: [pair], gitOrphans: [GIT_ORPHAN], diskOrphans: [DISK_ORPHAN], ruler: RULER };
}

// S18's unrelated-repo case: zero pairs, one EMPTY bucket beside one populated one.
function buildDiskOnlyView(): object {
    return {
        pairs: [],
        gitOrphans: [],
        diskOrphans: [DISK_ORPHAN],
        ruler: [countOneEventAt(DISK_ORPHAN)],
    };
}

// bootLayer1Page runs explicitly since node's module cache only fires the boot line on the first import.
async function loadPageWithView(view: object, search: string, progressLines: object[] = []): Promise<void> {
    initLayer1Dom(search);
    stubStreamRoute("/api/layer1-view", [...progressLines, view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await waitForAsyncWork();
}

// No ref, which the endpoint reads as the active branch.
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

function readAxisOffsetPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

function listMatching(selector: string): HTMLElement[] {
    return [...document.querySelectorAll(selector)] as HTMLElement[];
}

function listTextOf(root: HTMLElement, selector: string): (string | null)[] {
    return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

function readBoxValue(id: string): string {
    return (document.getElementById(id) as HTMLInputElement).value;
}

// Matching on NAME rather than position or size stops an inverted gitOrphans/diskOrphans binding from slipping through on shape.
function findBucketTitled(title: string): HTMLElement | undefined {
    return listMatching("#stage .filebox.bucket")
        .find((bucket) => bucket.querySelector(".fname")?.textContent === title);
}

test("test_each_orphan_bucket_binds_its_own_wire_property_to_its_own_title", async () => {
    // The two orphan sets mirror each other, so only checking WHICH path lands in WHICH bucket catches a swapped binding.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    assert.equal(listMatching("#stage .filebox.bucket").length, 2);
    const gitBucket = findBucketTitled("No on-disk match")!;
    assert.deepEqual(listTextOf(gitBucket, "li span"), [GIT_ORPHAN.path]);
    assert.equal(readAxisOffsetPx(gitBucket), GIT_ORPHAN.axisPx);
    const diskBucket = findBucketTitled("No repository match")!;
    assert.deepEqual(listTextOf(diskBucket, "li span"), [DISK_ORPHAN.path]);
    assert.equal(readAxisOffsetPx(diskBucket), DISK_ORPHAN.axisPx);
    // Task 276: seconds and hundredths are required, since minute precision made distinct instants render as identical, duplicate-looking text.
    assert.deepEqual(listTextOf(diskBucket, "li em"), ["07-23 19:40:00.000"]);
});

test("test_empty_bucket_is_omitted_and_zero_pairs_shows_the_no_pairs_message", async () => {
    // A view sharing no path must still draw the ruler and the populated bucket, not just a message.
    await loadPageWithView(buildDiskOnlyView(), BOTH_ROOTS_SEARCH);
    assert.equal(listMatching("#stage .filebox:not(.bucket)").length, 0);
    assert.equal(document.querySelector("#stage .nopairs")?.textContent, "No git ↔ on-disk pairs.");
    assert.equal(listMatching("#ruler .tick").length, 1);
    // The survivor must be the NON-EMPTY DIRECTION, not merely "a bucket".
    const buckets = listMatching("#stage .filebox.bucket");
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.querySelector(".fname")?.textContent, "No repository match");
    assert.equal(findBucketTitled("No on-disk match"), undefined);
});

test("test_the_url_query_seeds_the_header_boxes_and_a_load_mirrors_them_back", async () => {
    // All three inputs round-trip through the query so a view is one shareable link.
    await loadPageWithView(buildPartialOverlapView(), "?dir=%2Fw%2Fproj&repo=%2Fw%2Frepo&ref=main");
    assert.equal(readBoxValue("dir"), "/w/proj");
    assert.equal(readBoxValue("repo"), "/w/repo");
    assert.equal(readBoxValue("ref"), "main");
    const mirrored = new URLSearchParams(location.search);
    assert.deepEqual([...mirrored], [["dir", "/w/proj"], ["repo", "/w/repo"], ["ref", "main"]]);
});
