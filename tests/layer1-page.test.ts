// The wire is frozen with absolute axisPx, so fixtures state offsets directly instead of deriving them from timestamps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";

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

// The widget's subtraction base: its FIRST commit's absolute ruler position.
const WIDGET_BASE_PX = PAIR_COMMITS[0]!.axisPx;

function buildPartialOverlapView(): object {
    const pair = { path: "src/index.ts", commits: PAIR_COMMITS, onDisk: PAIR_ON_DISK };
    return { pairs: [pair], gitOrphans: [GIT_ORPHAN], diskOrphans: [DISK_ORPHAN], ruler: RULER };
}

// initLayer1Page runs explicitly since node's module cache only fires the boot line on the first import.
async function loadPageWithView(view: object, search: string, progressLines: object[] = []): Promise<void> {
    initLayer1Dom(search);
    installStreamRoute("/api/layer1-view", [...progressLines, view]);
    const { initLayer1Page } = await import("../webapp/layer1-page.ts");
    initLayer1Page();
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

// Matching on NAME rather than position or size stops an inverted gitOrphans/diskOrphans binding from slipping through on shape.
function findBucketTitled(title: string): HTMLElement | undefined {
    return listMatching("#stage .filebox.bucket")
        .find((bucket) => bucket.querySelector(".fname")?.textContent === title);
}

test("test_pair_widget_and_its_nodes_render_at_the_endpoints_axis_pixels", async () => {
    // A widget pins to its FIRST commit's absolute offset; its nodes are that offset subtracted.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    const widget = listMatching("#stage .filebox:not(.bucket)")[0]!;
    assert.equal(widget.querySelector(".fname")?.textContent, "index.ts");
    assert.equal(readAxisOffsetPx(widget), WIDGET_BASE_PX);
    assert.equal(widget.querySelector(".sub")?.textContent, "2 commits · on disk");
    // The hashes prove the order came from `commits`, not from a sort the page invented.
    assert.deepEqual(listMatching("#stage .node.n-commit").map(readAxisOffsetPx),
        [PAIR_COMMITS[0]!.axisPx - WIDGET_BASE_PX, PAIR_COMMITS[1]!.axisPx - WIDGET_BASE_PX]);
    // Labels are SHORT hashes: the full 40 characters overprinted the neighbouring widget.
    assert.deepEqual(listTextOf(widget, ".nlabel"), ["a1b2c3d4", "e4f5a6b7", "on disk"]);
    assert.deepEqual(listMatching("#stage .node.n-disk").map(readAxisOffsetPx),
        [PAIR_ON_DISK.axisPx - WIDGET_BASE_PX]);
    const lane = widget.querySelector(".lane") as HTMLElement;
    assert.equal(lane.style.getPropertyValue("--span-px"), String(PAIR_ON_DISK.axisPx - WIDGET_BASE_PX));
    assert.deepEqual(listMatching("#ruler .tick").map(readAxisOffsetPx), RULER.map((tick) => tick.axisPx));
    // Task 275: the "(n)" count comes off the wire rather than being derived here.
    assert.deepEqual(listMatching("#ruler .tick").map((tick) => tick.textContent), [
        "06-01 09:00:00.000 (1)", "06-01 14:30:00.000 (1)", "07-20 16:00:00.000 (1)",
        "07-23 19:40:00.000 (1)", "07-24 08:15:00.000 (1)",
    ]);
});

test("test_a_commit_label_shows_the_short_hash_and_reveals_the_full_one_on_hover", async () => {
    // 40 characters is wider than a widget, so only 8 show; the hover title keeps the full hash.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    const commitLabels = listMatching("#stage .n-commit + .nlabel");
    assert.deepEqual(commitLabels.map((label) => label.textContent), ["a1b2c3d4", "e4f5a6b7"]);
    assert.deepEqual(commitLabels.map((label) => label.getAttribute("title")),
        PAIR_COMMITS.map((commit) => commit.hash));
    // A title-less on-disk node proves the optional argument did not leak onto every node createElement() builds.
    const diskLabel = listMatching("#stage .n-disk + .nlabel")[0]!;
    assert.equal(diskLabel.textContent, "on disk");
    assert.equal(diskLabel.hasAttribute("title"), false);
});

test("test_a_file_name_label_shows_the_basename_and_reveals_the_full_path_on_hover", async () => {
    // Task 245: the bubble is fixed at 168 px; truncating the path (not the basename) keeps same-directory siblings distinct.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    const name = listMatching("#stage .filebox:not(.bucket) .fname")[0]!;
    assert.equal(name.textContent, "index.ts");
    // Task 280: the full path lives on `data-path`, not `title`, since the box and File Nav match against data-path.
    assert.equal(name.getAttribute("data-path"), "src/index.ts");
    assert.equal(name.hasAttribute("title"), false);
    // A bucket heading has no data-path, proving the attribute landed only on the pair widget's name element.
    assert.equal(findBucketTitled("No repository match")?.getAttribute("data-path"), null);
});
