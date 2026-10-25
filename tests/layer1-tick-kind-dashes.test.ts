// Ruler dashes: one small bar per visible node kind drawn at a tick's instant, named by its show-row label.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { el } from "../webapp/app-dom.ts";
import { renderShowRowWithKindFilter } from "../webapp/layer1-kind-filter.ts";
import { makeRulerTickClickable } from "../webapp/layer1-ruler-click.ts";
import { markMultiEventTicks, onExpansionRelayout, wireTickExpansion } from "../webapp/layer1-tick-files.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const SHARED_PX = 40;
const INSTANT = "2026-06-02T09:00:00.000Z";
const TICK_TEXT = "06-02 09:00:00 (3)";
const BOX_VIEW = {
    pairs: [{ path: "a.ts", commits: [{ hash: "abc" }], onDisk: {}, snapshots: [{}] }], gitOrphans: [], diskOrphans: [],
} as never;

function setAxisPx(element: HTMLElement, axisPx: number): HTMLElement {
    element.style.setProperty("--axis-px", String(axisPx));
    return element;
}

function buildNode(kindClass: string): HTMLElement[] {
    return [setAxisPx(el("i", { class: `node ${kindClass}` }), 0), setAxisPx(el("span", { class: "nlabel", text: kindClass }), 0)];
}

// One bubble with a node per kind class at the shared instant, plus its ruler tick.
function drawRowOf(kindClasses: string[]): HTMLElement {
    initLayer1Dom();
    renderShowRowWithKindFilter(BOX_VIEW, () => {});
    document.getElementById("stage")!.replaceChildren(setAxisPx(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "a.ts", "data-path": "a.ts" }),
        el("div", { class: "lane" }, kindClasses.flatMap(buildNode)),
    ]), SHARED_PX));
    const tick = setAxisPx(el("div", { class: "tick", text: TICK_TEXT }), SHARED_PX);
    document.getElementById("ruler")!.appendChild(tick);
    makeRulerTickClickable(tick, { axisPx: SHARED_PX, text: TICK_TEXT, axisPxList: [SHARED_PX], instants: [INSTANT] });
    onExpansionRelayout(markMultiEventTicks);
    wireTickExpansion();
    markMultiEventTicks();
    return tick;
}

function toggleBox(kind: string, checked: boolean): void {
    const box = document.querySelector<HTMLInputElement>(`#show-row [data-kind=${kind}]`)!;
    box.checked = checked;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function readDashes(tick: HTMLElement): { title: string; className: string }[] {
    return [...tick.querySelectorAll<HTMLElement>(".kind-dashes i")].map((dash) => ({ title: dash.title, className: dash.className }));
}

test("test_a_tick_with_two_kinds_shows_two_titled_dashes_in_show_row_order", () => {
    const tick = drawRowOf(["n-snap", "n-commit", "n-commit"]);
    assert.deepEqual(readDashes(tick), [
        { title: "commit", className: "kdash kdash-commit" },
        { title: "📸 snapshot", className: "kdash kdash-snapshot" },
    ]);
});

test("test_a_tick_with_one_kind_shows_one_dash", () => {
    const tick = drawRowOf(["n-disk", "n-disk"]);
    assert.deepEqual(readDashes(tick), [{ title: "on-disk", className: "kdash kdash-disk" }]);
});

test("test_unticking_a_kind_removes_its_dash_and_never_stacks_containers", () => {
    const tick = drawRowOf(["n-snap", "n-commit"]);
    toggleBox("snapshot", false);
    assert.deepEqual(readDashes(tick).map((dash) => dash.title), ["commit"]);
    assert.equal(tick.querySelectorAll(".kind-dashes").length, 1);
    toggleBox("snapshot", true);
    markMultiEventTicks();
    assert.equal(readDashes(tick).length, 2);
    assert.equal(tick.querySelectorAll(".kind-dashes").length, 1);
});

test("test_kinds_hidden_on_load_get_no_dash", () => {
    const tick = drawRowOf(["n-commit", "n-edit", "n-script"]);
    assert.deepEqual(readDashes(tick).map((dash) => dash.title), ["commit"]);
});

test("test_dash_slot_is_28px_wide_with_a_4px_gap", () => {
    const css = readFileSync(new URL("../webapp/layer1-styles.css", import.meta.url), "utf8");
    assert.match(css, /\.kind-dashes \{[^}]*gap: 4px;[^}]*width: 28px;/);
});

test("test_dashes_add_no_text_to_the_tick", () => {
    const tick = drawRowOf(["n-snap", "n-commit"]);
    assert.equal(tick.textContent, TICK_TEXT);
});
