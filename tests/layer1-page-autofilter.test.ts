// Feature (2026-07-29): growing the File Nav selection past one item auto-arms "Show Only Selected".

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
    // The toggle state survives at module scope, so each test opens with it disarmed.
    const armed = document.getElementById("filenav-only-selected") as HTMLElement;
    if (armed.classList.contains("current")) {
        armed.click();
    }
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

test("test_single_selection_leaves_the_toggle_off_and_the_stage_unfiltered", () => {
    // Scenario: one selected item is not a multi-selection, so nothing auto-arms.  Steps: open the page and shift-click one file.
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    assert.equal(onlySelectedButton().classList.contains("current"), false);
    assert.equal(document.querySelectorAll("#stage .filebox").length, 3);
});

test("test_growing_the_selection_past_one_item_arms_the_toggle_and_filters", () => {
    // The second shift-click makes a multi-selection: toggle auto-arms, stage filters to it.
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    assert.equal(onlySelectedButton().classList.contains("current"), true);
    const shown = [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")].map((n) => n.dataset.path);
    assert.deepEqual(shown.sort(), ["src/keep/a.ts", "src/keep/b.ts"]);
});

test("test_an_armed_toggle_is_not_rearmed_or_cleared_by_further_selection_changes", () => {
    // Once armed, shrinking the selection back to one item leaves the toggle armed.
    openLayer1Page();
    shiftClick(findNavRow(".file-item", "src/keep/a.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    shiftClick(findNavRow(".file-item", "src/keep/b.ts"));
    assert.equal(onlySelectedButton().classList.contains("current"), true);
    const shown = [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")].map((n) => n.dataset.path);
    assert.deepEqual(shown, ["src/keep/a.ts"]);
});
