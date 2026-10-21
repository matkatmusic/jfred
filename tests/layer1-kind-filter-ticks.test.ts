// Task 360: hidden kinds leave the ruler: events drop, all-hidden ticks hide, jump skips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el } from "../webapp/app-dom.ts";
import { renderShowRowWithKindFilter } from "../webapp/layer1-kind-filter.ts";
import { makeRulerTickClickable } from "../webapp/layer1-ruler-click.ts";
import {
    listEventsAtRow, markMultiEventTicks, onExpansionRelayout, readRulerExpansion, toggleExpandedRow, wireTickExpansion,
} from "../webapp/layer1-tick-files.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

const SHARED_PX = 40;
const INSTANT = "2026-06-02T09:00:00.000Z";
const BOX_VIEW = {
    pairs: [{ path: "a.ts", commits: [{ hash: "abc" }], onDisk: {}, snapshots: [{}] }], gitOrphans: [], diskOrphans: [],
} as never;

function setAxisPx(element: HTMLElement, axisPx: number): HTMLElement {
    element.style.setProperty("--axis-px", String(axisPx));
    return element;
}

function buildNode(kindClass: string, label: string): HTMLElement[] {
    return [setAxisPx(el("i", { class: `node ${kindClass}` }), 0), setAxisPx(el("span", { class: "nlabel", text: label }), 0)];
}

// One bubble: a node per kind at the shared instant, plus its ruler tick.
function drawRowOf(kindClasses: string[], extra: HTMLElement[] = []): HTMLElement {
    setupLayer1Dom();
    renderShowRowWithKindFilter(BOX_VIEW);
    const nodes = kindClasses.flatMap((kindClass) => buildNode(kindClass, kindClass));
    document.getElementById("stage")!.replaceChildren(setAxisPx(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "a.ts", "data-path": "a.ts" }),
        el("div", { class: "lane" }, nodes),
    ]), SHARED_PX), ...extra);
    const tick = setAxisPx(el("div", { class: "tick" }), SHARED_PX);
    document.getElementById("ruler")!.appendChild(tick);
    makeRulerTickClickable(tick, { axisPx: SHARED_PX, text: "", axisPxList: [SHARED_PX], instants: [INSTANT] });
    onExpansionRelayout(markMultiEventTicks);
    wireTickExpansion();
    return tick;
}

function toggleBox(kind: string, checked: boolean): void {
    const box = document.querySelector<HTMLInputElement>(`#show-row [data-kind=${kind}]`)!;
    box.checked = checked;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("test_listEventsAtRow_omits_events_of_a_hidden_kind", () => {
    drawRowOf(["n-commit", "n-snap"]);
    assert.equal(listEventsAtRow([SHARED_PX]).length, 2);
    toggleBox("snapshot", false);
    assert.deepEqual(listEventsAtRow([SHARED_PX]).map((event) => event.kind), ["n-commit"]);
});

test("test_a_tick_whose_events_are_all_hidden_gets_the_kind_hidden_class", () => {
    const tick = drawRowOf(["n-snap"]);
    toggleBox("snapshot", false);
    markMultiEventTicks();
    assert.ok(tick.classList.contains("kind-hidden"));
    assert.equal(tick.style.getPropertyValue("--axis-px"), String(SHARED_PX));
});

test("test_a_tick_with_one_visible_kind_stays_shown_and_loses_multi", () => {
    const tick = drawRowOf(["n-commit", "n-snap"]);
    markMultiEventTicks();
    assert.ok(tick.classList.contains("multi"));
    toggleBox("snapshot", false);
    assert.ok(!tick.classList.contains("kind-hidden"));
    assert.ok(!tick.classList.contains("multi"));
});

test("test_unhiding_a_kind_clears_kind_hidden_and_restores_multi", () => {
    const tick = drawRowOf(["n-commit", "n-snap"]);
    toggleBox("commit", false);
    toggleBox("snapshot", false);
    assert.ok(tick.classList.contains("kind-hidden"));
    toggleBox("commit", true);
    toggleBox("snapshot", true);
    assert.ok(!tick.classList.contains("kind-hidden"));
    assert.ok(tick.classList.contains("multi"));
});

test("test_an_expanded_row_refilters_its_file_list_on_toggle", () => {
    const tick = drawRowOf(["n-commit", "n-disk", "n-snap"]);
    toggleExpandedRow(tick, listEventsAtRow([SHARED_PX]));
    assert.equal(tick.querySelectorAll(".tickfiles button").length, 3);
    toggleBox("snapshot", false);
    assert.equal(tick.querySelectorAll(".tickfiles button").length, 2);
    assert.ok(tick.classList.contains("expanded"));
});

test("test_an_expanded_row_closes_when_one_visible_event_remains", () => {
    const tick = drawRowOf(["n-commit", "n-disk", "n-snap"]);
    toggleExpandedRow(tick, listEventsAtRow([SHARED_PX]));
    toggleBox("snapshot", false);
    toggleBox("disk", false);
    assert.equal(readRulerExpansion(), undefined);
    assert.equal(tick.querySelector(".tickfiles"), null);
});

test("test_orphan_rows_are_never_hidden", () => {
    drawRowOf(["n-snap"], [setAxisPx(el("div", { class: "filebox bucket" }, [
        el("div", { class: "fname", text: "No repository match" }),
        el("ul", {}, [setAxisPx(el("li", {}, [el("span", { text: "notes/scratch.txt" })]), 0)]),
    ]), SHARED_PX)]);
    for (const kind of ["commit", "disk", "snapshot"]) {
        toggleBox(kind, false);
    }
    const events = listEventsAtRow([SHARED_PX]);
    assert.deepEqual(events.map((event) => event.path), ["notes/scratch.txt"]);
    assert.equal(events[0]!.nodeKind, undefined);
});

test("test_the_ruler_jump_skips_a_hidden_node", () => {
    const tick = drawRowOf(["n-commit", "n-snap"]);
    toggleBox("commit", false);
    const landedOn: HTMLElement[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(".node")) {
        node.scrollIntoView = () => landedOn.push(node);
    }
    tick.dispatchEvent(new window.Event("click"));
    assert.equal(landedOn.length, 1);
    assert.ok(landedOn[0]!.classList.contains("n-snap"));
});
