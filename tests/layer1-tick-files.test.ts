// Task 284: a gutter row several events share expands into the files touched at that instant. This
// covers the reading half — what listEventsAtRow finds on the drawn stage — because that is where
// the row's list can silently disagree with the "(n)" printed beside the label: a name missing, a
// name listed twice, or a bucket's heading listed as though it were a file.
//
// The stage is built here by hand rather than through the page: the contract is with the DOM
// layer1-page.ts renders (`.filebox` > `.fname[data-path]`, `.node` + `.nlabel`, a bucket's `li`),
// and building it directly is what lets one instant be shared by two bubbles in four lines.
// happy-dom implements no layout, and nothing here needs it — every offset is a published
// `--axis-px`, the one value the page contributes to placement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el } from "../webapp/app-dom.ts";
import { listEventsAtRow } from "../webapp/layer1-tick-files.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// The shared instant: where the second bubble BEGINS and where the first one holds an interior
// node. Absolute ruler offsets, exactly as the endpoint ships them.
const EARLY_PX = 10;
const SHARED_PX = 40;

function setAxisPx(element: HTMLElement, axisPx: number): HTMLElement {
    element.style.setProperty("--axis-px", String(axisPx));
    return element;
}

// One pair's node: the dot and the `.nlabel` beside it, both at the same WIDGET-RELATIVE offset.
// The label is the node's own name for itself — a short hash, or "on disk".
function buildNode(axisPx: number, label: string): HTMLElement[] {
    return [
        setAxisPx(el("i", { class: "node n-commit" }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text: label }), axisPx),
    ];
}

// One pair's bubble, named by its basename with the full path on `data-path` (task 280), offset to
// its earliest node, its nodes carrying offsets relative to that.
function buildPairBubble(path: string, bubblePx: number, nodes: HTMLElement[]): HTMLElement {
    return setAxisPx(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: path.split("/").pop()!, "data-path": path }),
        el("div", { class: "lane" }, nodes),
    ]), bubblePx);
}

// One orphan bucket: a heading that is NOT a file, and rows whose own first span IS the file.
function buildOrphanBubble(title: string, path: string, bucketPx: number): HTMLElement {
    return setAxisPx(el("div", { class: "filebox bucket" }, [
        el("div", { class: "fname", text: title }),
        el("ul", {}, [setAxisPx(el("li", {}, [el("span", { text: path }), el("em", { text: "07-18 19:42:08.22" })]), 0)]),
    ]), bucketPx);
}

// A fresh page carrying the built bubbles on its stage, and nothing else. `build` is a callback
// rather than a ready-made array because `el` reads the global `document`, which setupLayer1Dom is
// what installs — bubbles built in the argument list would be built against the previous test's page.
function drawStage(build: () => HTMLElement[]): void {
    setupLayer1Dom();
    document.getElementById("stage")!.replaceChildren(...build());
}

// spanning.ts begins EARLY and holds an interior node on the shared instant; beginning.ts BEGINS on
// it. Both draw a row at SHARED_PX, which is the whole point of the expansion.
function drawTwoBubblesSharingOneInstant(): void {
    drawStage(() => [
        buildPairBubble("src/spanning.ts", EARLY_PX, [
            ...buildNode(0, "a1b2c3d"),
            ...buildNode(SHARED_PX - EARLY_PX, "e4f5a6b"),
        ]),
        buildPairBubble("src/beginning.ts", SHARED_PX, buildNode(0, "on disk")),
    ]);
}

test("test_listEventsAtRow_names_every_file_drawn_at_the_rows_instant", () => {
    // Scenario (task 284): two bubbles draw a row at one instant, so a click that jumps has to pick
    // one of them silently — which is the bug. The list must hold BOTH, each named by its own
    // bubble and labelled by its own node, and each carrying the element a click would land on.
    // Steps: draw the two bubbles, then list what stands at the shared instant.
    drawTwoBubblesSharingOneInstant();
    const events = listEventsAtRow([SHARED_PX]);
    assert.deepEqual(events.map((event) => event.path), ["src/beginning.ts", "src/spanning.ts"]);
    // the kind is the node's OWN label, not the bubble's — that is what tells two rows of the same
    // file apart, and what the button prints after the name.
    assert.deepEqual(events.map((event) => event.kind), ["on disk", "e4f5a6b"]);
    // and the element is the `.node` drawn there, so clicking the name needs no second lookup.
    assert.deepEqual(events.map((event) => event.element.className), ["node n-commit", "node n-commit"]);
});

test("test_listEventsAtRow_lists_a_shared_element_once_however_many_entries_the_row_absorbed", () => {
    // Scenario (task 284 + the user, 2026-07-26: "(3) is shown but only 2 file names are
    // displayed"): a merged row stands for several entries, and two of them can be laid out at the
    // same offset — the merge is on the printed label, which is coarser than the axis. Without the
    // de-duplication every element drawn there is listed once per entry.
    // Steps: draw the two bubbles, then list a row that absorbed the same offset twice.
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([SHARED_PX, SHARED_PX]).map((event) => event.path),
        ["src/beginning.ts", "src/spanning.ts"]);
});

test("test_listEventsAtRow_reads_a_merged_rows_absorbed_instants_too", () => {
    // Scenario (task 284.1): 247 of this repo's 683 ruler entries are absorbed into the row above
    // them. A list built from the surviving entry's own offset alone would show one file where the
    // row's own count says two.
    // Steps: draw the two bubbles, then list the row that absorbed both offsets.
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([EARLY_PX, SHARED_PX]).map((event) => event.kind),
        ["a1b2c3d", "on disk", "e4f5a6b"]);
});

test("test_listEventsAtRow_names_an_orphan_by_its_own_row_and_not_its_buckets_heading", () => {
    // Scenario (mockup 899-903): an orphan has no bubble of its own, so the thing drawn for it is
    // its ROW inside a bucket. The bucket's `.fname` is a heading — listing it here put "No
    // repository match" in the list as though it were a file, which the user rejected.
    // Steps: draw a one-row bucket and list what stands at its instant.
    drawStage(() => [buildOrphanBubble("No repository match", "notes/scratch.txt", SHARED_PX)]);
    const events = listEventsAtRow([SHARED_PX]);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.path, "notes/scratch.txt");
    // empty: the bucket the name jumps to is what says which direction the orphan is.
    assert.equal(events[0]!.kind, "");
    // and the element is the ROW, so the click lands on the orphan rather than on its bucket.
    assert.equal(events[0]!.element, document.querySelector("li"));
});
