// Task 284: what listEventsAtRow finds on the drawn stage, where a row's list can silently
// disagree with the "(n)" beside its label. The stage is built by hand against the DOM
// layer1-page.ts renders; happy-dom has no layout, and every offset here is a published `--axis-px`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el } from "../webapp/app-dom.ts";
import { listEventsAtRow } from "../webapp/layer1-tick-files.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// Absolute ruler offsets, exactly as the endpoint ships them.
const EARLY_PX = 10;
const SHARED_PX = 40;

function setAxisPx(element: HTMLElement, axisPx: number): HTMLElement {
    element.style.setProperty("--axis-px", String(axisPx));
    return element;
}

// Dot and label share one WIDGET-RELATIVE offset; the label is the node's own name for itself.
function buildNode(axisPx: number, label: string): HTMLElement[] {
    return [
        setAxisPx(el("i", { class: "node n-commit" }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text: label }), axisPx),
    ];
}

// Named by basename with the full path on `data-path` (task 280); nodes offset relative to it.
function buildPairBubble(path: string, bubblePx: number, nodes: HTMLElement[]): HTMLElement {
    return setAxisPx(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: path.split("/").pop()!, "data-path": path }),
        el("div", { class: "lane" }, nodes),
    ]), bubblePx);
}

// The bucket heading is NOT a file; each row's own first span IS.
function buildOrphanBubble(title: string, path: string, bucketPx: number): HTMLElement {
    return setAxisPx(el("div", { class: "filebox bucket" }, [
        el("div", { class: "fname", text: title }),
        el("ul", {}, [setAxisPx(el("li", {}, [el("span", { text: path }), el("em", { text: "07-18 19:42:08.22" })]), 0)]),
    ]), bucketPx);
}

// `build` is a callback because `el` reads the global `document` that setupLayer1Dom installs —
// bubbles built in the argument list would bind to the previous test's page.
function drawStage(build: () => HTMLElement[]): void {
    setupLayer1Dom();
    document.getElementById("stage")!.replaceChildren(...build());
}

// spanning.ts holds an interior node on the shared instant; beginning.ts BEGINS on it, so both
// draw a row at SHARED_PX.
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
    // Task 284: two bubbles at one instant made a click pick one silently. The list must hold BOTH,
    // each with the element a click would land on.
    drawTwoBubblesSharingOneInstant();
    const events = listEventsAtRow([SHARED_PX]);
    assert.deepEqual(events.map((event) => event.path), ["src/beginning.ts", "src/spanning.ts"]);
    // The kind is the node's OWN label, which is what tells two rows of the same file apart.
    assert.deepEqual(events.map((event) => event.kind), ["on disk", "e4f5a6b"]);
    assert.deepEqual(events.map((event) => event.element.className), ["node n-commit", "node n-commit"]);
});

test("test_listEventsAtRow_lists_a_shared_element_once_however_many_entries_the_row_absorbed", () => {
    // Merging is on the printed label, coarser than the axis, so two entries can share an offset;
    // without de-duplication each element is listed once per entry ("(3)" but two names).
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([SHARED_PX, SHARED_PX]).map((event) => event.path),
        ["src/beginning.ts", "src/spanning.ts"]);
});

test("test_listEventsAtRow_reads_a_merged_rows_absorbed_instants_too", () => {
    // Task 284.1: many ruler entries are absorbed into the row above, so listing only the surviving
    // entry's offset would show fewer files than the row's own count.
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([EARLY_PX, SHARED_PX]).map((event) => event.kind),
        ["a1b2c3d", "on disk", "e4f5a6b"]);
});

test("test_listEventsAtRow_names_an_orphan_by_its_own_row_and_not_its_buckets_heading", () => {
    // An orphan is drawn as a ROW inside a bucket; the bucket's `.fname` is a heading, and listing
    // it put "No repository match" in the list as though it were a file.
    drawStage(() => [buildOrphanBubble("No repository match", "notes/scratch.txt", SHARED_PX)]);
    const events = listEventsAtRow([SHARED_PX]);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.path, "notes/scratch.txt");
    assert.equal(events[0]!.kind, "");
    // The element is the ROW, so the click lands on the orphan rather than on its bucket.
    assert.equal(events[0]!.element, document.querySelector("li"));
});
