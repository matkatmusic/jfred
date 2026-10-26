// Task 253: clicking a file in a selected nav folder must still scroll to its bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts boots at MODULE SCOPE, so absorb that first import against a throwaway DOM (the same guard as tests/layer1-find-file.test.ts).
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";

// Two folders under one `src/` prefix, so `keep` and `drop` are sibling folder rows in the nav.
const FULL_VIEW = {
    pairs: [
        { path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
        { path: "src/keep/b.ts", commits: [{ hash: "ba", instant: T1, axisPx: 22 }], onDisk: { instant: T2, axisPx: 44 } },
        { path: "src/drop/c.ts", commits: [{ hash: "ca", instant: T0, axisPx: 0 }], onDisk: { instant: T2, axisPx: 44 } },
    ],
    gitOrphans: [],
    diskOrphans: [],
    // eventCount is task 275's per-instant node tally: unasserted here, but the ruler gutter requires it.
    ruler: [
        { instant: T0, axisPx: 0, eventCount: 2 },
        { instant: T1, axisPx: 22, eventCount: 2 },
        { instant: T2, axisPx: 44, eventCount: 2 },
    ],
};

// The full path of every element scrollIntoView was called on, in call order.
const scrolledPaths: string[] = [];

// Boot a fresh page with the whole view and a scrollIntoView spy on the prototype.
function openLayer1Page(): void {
    initLayer1Dom();
    HTMLElement.prototype.scrollIntoView = function recordScroll(this: HTMLElement): void {
        scrolledPaths.push(this.querySelector(".fname")?.getAttribute("data-path") ?? "");
    };
    scrolledPaths.length = 0;
    renderLayer1View(FULL_VIEW);
}

// A File Nav row, found by the full path in its `title` (only bubbles use `data-path`).
function findNavRow(selector: string, label: string): HTMLElement {
    const row = [...document.querySelectorAll<HTMLElement>(`#filenav-tree ${selector}`)]
        .find((candidate) => (candidate.getAttribute("title") ?? candidate.textContent) === label);
    assert.ok(row !== undefined, `no File Nav ${selector} for ${label}`);
    return row;
}

test("test_clicking_a_file_scrolls_to_its_bubble_with_no_folder_selected", () => {
    // Scenario: with no filter applied, clicking the src/keep/a.ts leaf scrolls to its bubble.
    openLayer1Page();
    findNavRow(".file-item", "src/keep/a.ts").click();
    // its bubble was asked to scroll itself.
    assert.deepEqual(scrolledPaths, ["src/keep/a.ts"]);
});

test("test_clicking_a_file_inside_the_selected_folder_still_scrolls_to_its_bubble", () => {
    // Scenario (the reported bug): after selecting folder keep, clicking src/keep/a.ts must still scroll to its bubble.
    openLayer1Page();
    findNavRow("summary.file-folder-name", "keep").click();
    scrolledPaths.length = 0;
    findNavRow(".file-item", "src/keep/a.ts").click();
    // its bubble was asked to scroll itself.
    assert.deepEqual(scrolledPaths, ["src/keep/a.ts"]);
});
