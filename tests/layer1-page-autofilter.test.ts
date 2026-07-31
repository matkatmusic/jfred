// Task 333: a growing File Nav selection stays on the FULL timeline; auto-arming "Show Only Selected" was rejected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts boots at MODULE SCOPE, so absorb that first import against a throwaway DOM.
setupLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-page.ts");

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";

const FULL_VIEW = {
    pairs: [
        { path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
        { path: "src/keep/b.ts", commits: [{ hash: "ba", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
        { path: "src/drop/c.ts", commits: [{ hash: "ca", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
    ],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [
        { instant: T0, axisPx: 0, eventCount: 3 },
        { instant: T1, axisPx: 22, eventCount: 3 },
    ],
};

function openLayer1Page(): void {
    setupLayer1Dom();
    renderLayer1View(FULL_VIEW);
}

// A File Nav row matched by title/text, as tests/layer1-filter-jump.test.ts does.
function findNavRow(selector: string, label: string): HTMLElement {
    const row = [...document.querySelectorAll<HTMLElement>(`#filenav-tree ${selector}`)]
        .find((candidate) => (candidate.getAttribute("title") ?? candidate.textContent) === label);
    assert.ok(row !== undefined, `no File Nav ${selector} for ${label}`);
    return row;
}

function shiftClick(element: HTMLElement): void {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
}

function onlySelectedButton(): HTMLElement {
    return document.getElementById("filenav-only-selected") as HTMLElement;
}

function shownPaths(): (string | undefined)[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")].map((n) => n.dataset.path).sort();
}

test("test_a_single_selection_leaves_the_toggle_off_and_the_stage_unfiltered", () => {
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    assert.equal(onlySelectedButton().classList.contains("current"), false);
    assert.equal(document.querySelectorAll("#stage .filebox").length, 3);
});

test("test_growing_the_selection_past_one_item_does_not_arm_the_toggle_or_filter_the_stage", () => {
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    assert.equal(onlySelectedButton().classList.contains("current"), false);
    // The FULL timeline stays up — all three files, not just the two selected.
    assert.deepEqual(shownPaths(), ["src/drop/c.ts", "src/keep/a.ts", "src/keep/b.ts"]);
});

test("test_a_multi_selection_paints_a_nav_wash_over_the_full_timeline", () => {
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    assert.equal(document.querySelectorAll("#washes .nav-wash").length, 1);
});

test("test_manually_toggling_show_only_selected_neither_destroys_the_nav_wash_nor_drops_it_on_toggle_off", () => {
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    onlySelectedButton().click();
    assert.equal(onlySelectedButton().classList.contains("current"), true);
    assert.deepEqual(shownPaths(), ["src/keep/a.ts", "src/keep/b.ts"]);
    assert.equal(document.querySelectorAll("#washes .nav-wash").length, 1);
    onlySelectedButton().click();
    assert.equal(onlySelectedButton().classList.contains("current"), false);
    assert.deepEqual(shownPaths(), ["src/drop/c.ts", "src/keep/a.ts", "src/keep/b.ts"]);
    assert.equal(document.querySelectorAll("#washes .nav-wash").length, 1);
});
