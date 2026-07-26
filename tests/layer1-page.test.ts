// Task 237 (spec S18): the Layer 1 View page renders widgets, nodes and buckets at the offsets
// GET /api/layer1-view supplies. The wire is FROZEN and carries ABSOLUTE axisPx on every node, so
// the page's one permitted arithmetic operation — subtracting a widget's own base offset — is what
// these tests prove. No timestamp below is converted to a pixel: the fixtures STATE the offsets,
// exactly as tests/layered-app-widgets.test.ts does (tests/layer1-ruler-axis.test.ts and task 240
// cover the resolver's real values). Expected offsets are read back off the fixture rows rather
// than repeated as literals — a renumbered fixture must not leave a stale expectation behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

// One placed moment as the endpoint ships it.
interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// One commit node of the pair's ladder.
interface FixtureCommit extends FixtureInstant {
    hash: string;
}

// The pair's ladder, oldest first — the order the endpoint emits and the page must preserve.
// REAL 40-character hashes: 7-char fakes would pass a broken truncation unchanged.
const PAIR_COMMITS: FixtureCommit[] = [
    { hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", instant: "2026-06-01T09:00:00.000Z", axisPx: 10 },
    { hash: "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5", instant: "2026-06-01T14:30:00.000Z", axisPx: 24 },
];

// The pair's current on-disk state — S18's final node.
const PAIR_ON_DISK: FixtureInstant = { instant: "2026-07-24T08:15:00.000Z", axisPx: 66 };

// In the repo at `ref`, absent from disk — the "No on-disk match" bucket's only member.
const GIT_ORPHAN = { path: "docs/old-api.md", instant: "2026-07-20T16:00:00.000Z", axisPx: 38 };

// On disk, absent from the repo — the "No repository match" bucket's only member.
const DISK_ORPHAN = { path: "notes.txt", instant: "2026-07-23T19:40:00.000Z", axisPx: 52 };

// Every distinct instant the view draws, ascending. Adjacent offsets sit 14 px apart — clear of
// the page's 13 px tick-label collision threshold — so all five draw and no assertion below
// accidentally exercises the skip, which has its own test.
const RULER: FixtureInstant[] = [
    PAIR_COMMITS[0]!, PAIR_COMMITS[1]!, GIT_ORPHAN, DISK_ORPHAN, PAIR_ON_DISK,
];

// The widget's subtraction base: its FIRST commit's absolute ruler position.
const WIDGET_BASE_PX = PAIR_COMMITS[0]!.axisPx;

// A partial-overlap view: one pair touched by two commits, one git orphan, one disk orphan.
function buildPartialOverlapView(): object {
    const pair = { path: "src/index.ts", commits: PAIR_COMMITS, onDisk: PAIR_ON_DISK };
    return { pairs: [pair], gitOrphans: [GIT_ORPHAN], diskOrphans: [DISK_ORPHAN], ruler: RULER };
}

// The unrelated-repo shape from S18's acceptance test, reduced to what this page must draw: zero
// pairs, one EMPTY bucket beside one populated one.
function buildDiskOnlyView(): object {
    return {
        pairs: [],
        gitOrphans: [],
        diskOrphans: [DISK_ORPHAN],
        ruler: [DISK_ORPHAN],
    };
}

// A view whose only content is a ruler — used to drive the tick-label collision skip on its own.
function buildRulerOnlyView(ruler: FixtureInstant[]): object {
    return { pairs: [], gitOrphans: [], diskOrphans: [], ruler };
}

// Set up a fresh page whose URL already names both roots, stub the endpoint, and boot it.
// bootLayer1Page is called EXPLICITLY rather than relying on the module's own boot line: node's
// module cache runs that only on the first import, so later tests would otherwise render nothing.
// The page reads an NDJSON progress stream, so the stub is a stream whose lines are `progressLines`
// followed by the view as the terminal (kind-less) line — the exact framing the route emits.
async function loadPageWithView(view: object, search: string, progressLines: object[] = []): Promise<void> {
    setupLayer1Dom(search);
    stubStreamRoute("/api/layer1-view", [...progressLines, view]);
    const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await flushAsyncWork();
}

// The default deep link: both roots named, no ref (the endpoint reads that as the active branch).
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";

// The finished ruler offset an element carries, in pixels.
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

// The bucket whose title is exactly `title` — a bucket's identity is its NAME, never its position
// or its size, so an inverted gitOrphans/diskOrphans binding cannot slip through on shape.
function findBucketTitled(title: string): HTMLElement | undefined {
    return listMatching("#stage .filebox.bucket")
        .find((bucket) => bucket.querySelector(".fname")?.textContent === title);
}

test("test_pair_widget_and_its_nodes_render_at_the_endpoints_axis_pixels", async () => {
    // Scenario (task 237, spec S18): a pair widget is offset to its FIRST commit's absolute ruler
    // position, and every node inside it sits at that node's offset MINUS the widget's own.
    // Steps:
    // load the partial-overlap view.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    // the widget pins to the first commit's absolute axisPx, passed through untouched.
    const widget = listMatching("#stage .filebox:not(.bucket)")[0]!;
    assert.equal(widget.querySelector(".fname")?.textContent, "index.ts");
    assert.equal(readAxisOffsetPx(widget), WIDGET_BASE_PX);
    assert.equal(widget.querySelector(".sub")?.textContent, "2 commits · on disk");
    // the commit nodes are widget-relative and in wire order — the hashes prove the order came
    // from `commits` rather than from some sort the page invented.
    assert.deepEqual(listMatching("#stage .node.n-commit").map(readAxisOffsetPx),
        [PAIR_COMMITS[0]!.axisPx - WIDGET_BASE_PX, PAIR_COMMITS[1]!.axisPx - WIDGET_BASE_PX]);
    // each dot is labelled with its commit's SHORT hash — the full 40 characters overprinted the
    // neighbouring widget.
    assert.deepEqual(listTextOf(widget, ".nlabel"), ["a1b2c3d4", "e4f5a6b7", "on disk"]);
    // the on-disk node is last, on the same widget-relative ruler, and the lane spans to hold it.
    assert.deepEqual(listMatching("#stage .node.n-disk").map(readAxisOffsetPx),
        [PAIR_ON_DISK.axisPx - WIDGET_BASE_PX]);
    const lane = widget.querySelector(".lane") as HTMLElement;
    assert.equal(lane.style.getPropertyValue("--span-px"), String(PAIR_ON_DISK.axisPx - WIDGET_BASE_PX));
    // the ruler gutter draws every supplied tick at the endpoint's own pixels.
    assert.deepEqual(listMatching("#ruler .tick").map(readAxisOffsetPx), RULER.map((tick) => tick.axisPx));
});

test("test_a_commit_label_shows_the_short_hash_and_reveals_the_full_one_on_hover", async () => {
    // Scenario (S18 feedback, user-locked 2026-07-25): 40 monospace characters is wider than a
    // widget, so a dot is LABELLED with its first 8 — but the whole hash must stay recoverable,
    // which is what the hover title is for. The wire is untouched: truncation happens only at render.
    // Steps:
    // load the partial-overlap view, whose two commits carry real 40-character hashes.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    const commitLabels = listMatching("#stage .n-commit + .nlabel");
    // each visible label is the 8-character prefix, and each title is that same commit's full hash.
    assert.deepEqual(commitLabels.map((label) => label.textContent), ["a1b2c3d4", "e4f5a6b7"]);
    assert.deepEqual(commitLabels.map((label) => label.getAttribute("title")),
        PAIR_COMMITS.map((commit) => commit.hash));
    // the on-disk node has nothing longer to reveal, so it carries NO title attribute at all —
    // which is what proves the optional argument did not leak onto every node el() builds.
    const diskLabel = listMatching("#stage .n-disk + .nlabel")[0]!;
    assert.equal(diskLabel.textContent, "on disk");
    assert.equal(diskLabel.hasAttribute("title"), false);
});

test("test_a_file_name_label_shows_the_basename_and_reveals_the_full_path_on_hover", async () => {
    // Scenario (task 245): a full path is unbounded in width but the bubble is a fixed 168 px,
    // so the label carries only the BASENAME — and because six sibling bubbles can share the
    // same leading directory, a truncated path would leave them all reading alike. The whole
    // path must stay recoverable, which is what the hover title is for.
    // Steps:
    // load the partial-overlap view, whose single pair is at "src/index.ts".
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    const name = listMatching("#stage .filebox:not(.bucket) .fname")[0]!;
    // the visible label is the basename alone — the directory is what overprinted the neighbours.
    assert.equal(name.textContent, "index.ts");
    // task 280: the full path lives on `data-path`, NOT on `title` — a `title` is the native
    // tooltip the user rejected (slow, unstyled, vanishes on movement), and the in-page hover
    // reveal in layer1-styles.css replaces it. data-path is also what the find box and the File
    // Nav's exact-path jump match against, so nothing the endpoint sent is unrecoverable.
    assert.equal(name.getAttribute("data-path"), "src/index.ts");
    assert.equal(name.hasAttribute("title"), false);
    // an orphan bucket's heading is not a path, so it must NOT gain one — that is what proves the
    // change landed on the pair widget's name and not on every .fname el() builds.
    assert.equal(findBucketTitled("No repository match")?.getAttribute("data-path"), null);
});

test("test_each_orphan_bucket_binds_its_own_wire_property_to_its_own_title", async () => {
    // Scenario (spec S18 "Output contract"): gitOrphans is the "No on-disk match" bucket and
    // diskOrphans the "No repository match" one. The two sets are mirror images, so this asserts
    // WHICH PATH lands in WHICH bucket — a swap would leave every count identical.
    // Steps:
    // load the partial-overlap view, whose two buckets hold one distinguishable path each.
    await loadPageWithView(buildPartialOverlapView(), BOTH_ROOTS_SEARCH);
    assert.equal(listMatching("#stage .filebox.bucket").length, 2);
    // gitOrphans (in the repo, absent from disk) -> "No on-disk match", at its first row's axisPx.
    const gitBucket = findBucketTitled("No on-disk match")!;
    assert.deepEqual(listTextOf(gitBucket, "li span"), [GIT_ORPHAN.path]);
    assert.equal(readAxisOffsetPx(gitBucket), GIT_ORPHAN.axisPx);
    // diskOrphans (on disk, absent from the repo) -> "No repository match".
    const diskBucket = findBucketTitled("No repository match")!;
    assert.deepEqual(listTextOf(diskBucket, "li span"), [DISK_ORPHAN.path]);
    assert.equal(readAxisOffsetPx(diskBucket), DISK_ORPHAN.axisPx);
    // each row carries its own timestamp beside its path.
    // task 276: the label carries seconds and hundredths, not just minutes. Instants seconds apart
    // rendered as identical text before this, which is what made distinct rows look duplicated.
    assert.deepEqual(listTextOf(diskBucket, "li em"), ["07-23 19:40:00.00"]);
});

test("test_empty_bucket_is_omitted_and_zero_pairs_shows_the_no_pairs_message", async () => {
    // Scenario (spec S18): buckets are omitted when empty, and a view sharing no path at all
    // renders the empty-state message instead of pair widgets — while still drawing the ruler and
    // the bucket that does have rows.
    // Steps:
    // load a view with zero pairs, an empty gitOrphans and one diskOrphans row.
    await loadPageWithView(buildDiskOnlyView(), BOTH_ROOTS_SEARCH);
    assert.equal(listMatching("#stage .filebox:not(.bucket)").length, 0);
    assert.equal(document.querySelector("#stage .nopairs")?.textContent, "No git ↔ on-disk pairs.");
    assert.equal(listMatching("#ruler .tick").length, 1);
    // exactly one bucket survives, and it is the NON-EMPTY DIRECTION — not merely "a bucket".
    const buckets = listMatching("#stage .filebox.bucket");
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.querySelector(".fname")?.textContent, "No repository match");
    assert.equal(findBucketTitled("No on-disk match"), undefined);
});

test("test_ruler_skips_a_tick_label_that_would_overprint_the_one_above_it", async () => {
    // Scenario (plans/layer1-mockup.html): at the locked 2.5 px/hour two nearby instants resolve
    // within a few pixels, so a tick label closer than 13 px to the last DRAWN one is dropped.
    // Steps:
    // load a ruler whose middle tick sits 4 px below the first and 10 px above the last.
    const crowded: FixtureInstant[] = [
        { instant: "2026-06-01T09:00:00.000Z", axisPx: 0 },
        { instant: "2026-06-01T10:36:00.000Z", axisPx: 4 },
        { instant: "2026-06-01T14:36:00.000Z", axisPx: 14 },
    ];
    await loadPageWithView(buildRulerOnlyView(crowded), BOTH_ROOTS_SEARCH);
    // the 4 px tick is dropped; the 14 px one still clears 13 px from the 0 px tick that DID draw.
    assert.deepEqual(listMatching("#ruler .tick").map(readAxisOffsetPx), [0, 14]);
    assert.deepEqual(listMatching("#ruler .tick").map((tick) => tick.textContent),
        ["06-01 09:00:00.00", "06-01 14:36:00.00"]);
});

test("test_the_url_query_seeds_the_header_boxes_and_a_load_mirrors_them_back", async () => {
    // Scenario (task 237, spec S18): all three inputs map to ?dir=&repo=&ref= so a view is one
    // shareable link — the URL fills the boxes on open, and loading writes them back to the URL.
    // Steps:
    // open the page on a link naming all three inputs.
    await loadPageWithView(buildPartialOverlapView(), "?dir=%2Fw%2Fproj&repo=%2Fw%2Frepo&ref=main");
    // every box holds its param, so the link opens on a populated form rather than an empty one.
    assert.equal(readBoxValue("dir"), "/w/proj");
    assert.equal(readBoxValue("repo"), "/w/repo");
    assert.equal(readBoxValue("ref"), "main");
    // and the load mirrored the boxes back into the URL — the other half of the round trip.
    const mirrored = new URLSearchParams(location.search);
    assert.deepEqual([...mirrored], [["dir", "/w/proj"], ["repo", "/w/repo"], ["ref", "main"]]);
});
