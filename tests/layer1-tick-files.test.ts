// Task 284: a row's list can disagree with its "(n)" label; stage is hand-built since happy-dom has no layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el } from "../webapp/app-dom.ts";
import { listEventsAtRow } from "../webapp/layer1-tick-files.ts";
import { flashSession } from "../webapp/layer1-sessions.ts";
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

// `build` is a callback because `el` reads the global `document`; inline bubbles would bind to the previous test's page.
function drawStage(build: () => HTMLElement[]): void {
    setupLayer1Dom();
    document.getElementById("stage")!.replaceChildren(...build());
}

// spanning.ts holds an interior node on the shared instant; beginning.ts BEGINS on it too, drawing a row at SHARED_PX.
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
    // Task 284: a click at one shared instant used to pick only one bubble; the list must hold BOTH.
    drawTwoBubblesSharingOneInstant();
    const events = listEventsAtRow([SHARED_PX]);
    assert.deepEqual(events.map((event) => event.path), ["src/beginning.ts", "src/spanning.ts"]);
    // The kind is the node's OWN label, which is what tells two rows of the same file apart.
    assert.deepEqual(events.map((event) => event.kind), ["on disk", "e4f5a6b"]);
    assert.deepEqual(events.map((event) => event.element.className), ["node n-commit", "node n-commit"]);
});

test("test_listEventsAtRow_lists_a_shared_element_once_however_many_entries_the_row_absorbed", () => {
    // Merging uses the printed label, coarser than the axis, so shared-offset entries need de-duplication to avoid double listing.
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([SHARED_PX, SHARED_PX]).map((event) => event.path),
        ["src/beginning.ts", "src/spanning.ts"]);
});

test("test_listEventsAtRow_reads_a_merged_rows_absorbed_instants_too", () => {
    // Task 284.1: absorbed ruler entries must all be listed, not just the row's surviving offset, or file counts undercount.
    drawTwoBubblesSharingOneInstant();
    assert.deepEqual(listEventsAtRow([EARLY_PX, SHARED_PX]).map((event) => event.kind),
        ["a1b2c3d", "on disk", "e4f5a6b"]);
});

// Task 315's snapshot node: `n-snap` dot + `@vN 📸` label, owning JSONL on `data-session-file`.
function buildSnapshotNode(axisPx: number, version: number, sessionFile: string): HTMLElement[] {
    const identity = { "data-session-file": sessionFile, "data-version": String(version) };
    return [
        setAxisPx(el("i", { class: "node n-snap", ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-snap", text: `@v${version} 📸` }), axisPx),
    ];
}

function seedSessionRows(...files: string[]): void {
    const host = document.getElementById("sessions")!;
    host.replaceChildren(...files.map((file) => {
        const item = el("div", { class: "session-item" });
        item.dataset.file = file;
        return item;
    }));
}

test("test_listEventsAtRow_reads_a_snapshot_rows_version_label_and_owning_session", () => {
    // Task 316: a snapshot row is `<filename> @vN 📸` and carries the JSONL its bytes came from.
    drawStage(() => [buildPairBubble("src/index.ts", SHARED_PX, buildSnapshotNode(0, 2, "sess-a.jsonl"))]);
    const [event] = listEventsAtRow([SHARED_PX]);
    assert.equal(event!.kind, "@v2 📸");
    assert.equal(event!.session, "sess-a.jsonl");
});

test("test_flashSession_highlights_the_owning_row_as_lead_without_selecting_it", () => {
    setupLayer1Dom();
    seedSessionRows("other.jsonl", "owner.jsonl");
    flashSession("owner.jsonl");
    const owner = document.querySelector('[data-file="owner.jsonl"]')!;
    assert.ok(owner.classList.contains("flash"));
    assert.ok(owner.classList.contains("flash-lead"));
    assert.ok(!owner.classList.contains("selected"), "flash must not filter the view");
    assert.ok(!document.querySelector('[data-file="other.jsonl"]')!.classList.contains("flash"));
});

test("test_flashSession_clears_the_previous_lead_so_two_clicks_leave_one", () => {
    // The trap the mockup found: a stale lead marker survives a second click unless every call clears it.
    setupLayer1Dom();
    seedSessionRows("a.jsonl", "b.jsonl");
    flashSession("a.jsonl");
    flashSession("b.jsonl");
    assert.equal(document.querySelectorAll(".flash-lead").length, 1);
    assert.ok(document.querySelector('[data-file="b.jsonl"]')!.classList.contains("flash-lead"));
});

test("test_flashSession_removes_the_highlight_after_the_fade", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    setupLayer1Dom();
    seedSessionRows("owner.jsonl");
    flashSession("owner.jsonl");
    t.mock.timers.tick(2600);
    const owner = document.querySelector('[data-file="owner.jsonl"]')!;
    assert.ok(!owner.classList.contains("flash"));
    assert.ok(!owner.classList.contains("flash-lead"));
});

test("test_listEventsAtRow_names_an_orphan_by_its_own_row_and_not_its_buckets_heading", () => {
    // An orphan is a ROW inside a bucket; the bucket's `.fname` is a heading, not a file.
    drawStage(() => [buildOrphanBubble("No repository match", "notes/scratch.txt", SHARED_PX)]);
    const events = listEventsAtRow([SHARED_PX]);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.path, "notes/scratch.txt");
    assert.equal(events[0]!.kind, "");
    // The element is the ROW, so the click lands on the orphan rather than on its bucket.
    assert.equal(events[0]!.element, document.querySelector("li"));
});
