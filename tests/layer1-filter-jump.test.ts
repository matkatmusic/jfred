// Task 253 bug report (2026-07-26): after selecting a folder in the File Nav, clicking a FILE in
// that folder no longer scrolls to its bubble.
//
// Driven through webapp/layer1-page.ts's real render rather than a hand-built stage, because the
// suspicion is in the wiring BETWEEN the nav, the filter and the stage — a fixture stage would skip
// exactly the step under test. scrollIntoView is spied on, as tests/layer1-find-file.test.ts does:
// happy-dom implements no layout and no scrolling, so the contract is "the right element was asked
// to scroll itself".

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts boots at MODULE SCOPE, so absorb that first import against a throwaway DOM
// (the same guard as tests/layer1-find-file.test.ts).
setupLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-page.ts");

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
    // eventCount is task 275's per-instant node tally: T0 is a.ts's and c.ts's first commit, T1 is
    // a.ts landing on disk plus b.ts's commit, T2 is b.ts's and c.ts's disk mtime. Nothing here
    // asserts on it — the ruler gutter refuses to draw an entry without one.
    ruler: [
        { instant: T0, axisPx: 0, eventCount: 2 },
        { instant: T1, axisPx: 22, eventCount: 2 },
        { instant: T2, axisPx: 44, eventCount: 2 },
    ],
};

// The full path of every element scrollIntoView was called on, in call order.
const scrolledPaths: string[] = [];

// Boot a fresh page holding the whole view, with the scroll spy installed on the prototype — the
// bubbles are rebuilt by every render, so the page, not the test, owns those elements.
function openLayer1Page(): void {
    setupLayer1Dom();
    HTMLElement.prototype.scrollIntoView = function recordScroll(this: HTMLElement): void {
        scrolledPaths.push(this.querySelector(".fname")?.getAttribute("data-path") ?? "");
    };
    scrolledPaths.length = 0;
    renderLayer1View(FULL_VIEW);
}

// A File Nav row, matched by the full path the tree's leaf renderer puts on its `title`. Task 280
// moved a BUBBLE's path from `title` to `data-path`, but that change stops at the bubble: a File Nav
// row is rendered by webapp/views/sidebar.ts, is not truncated by a 168 px box, and has no in-page
// hover reveal to make its native tooltip redundant — so `title` is still where its path lives.
function findNavRow(selector: string, label: string): HTMLElement {
    const row = [...document.querySelectorAll<HTMLElement>(`#filenav-tree ${selector}`)]
        .find((candidate) => (candidate.getAttribute("title") ?? candidate.textContent) === label);
    assert.ok(row !== undefined, `no File Nav ${selector} for ${label}`);
    return row;
}

test("test_clicking_a_file_scrolls_to_its_bubble_with_no_folder_selected", () => {
    // Scenario: the baseline the bug report is measured against — with no filter applied, a File Nav
    // leaf click scrolls to that file's bubble.
    // Steps:
    // open the page over the full view and click the leaf for src/keep/a.ts.
    openLayer1Page();
    findNavRow(".file-item", "src/keep/a.ts").click();
    // its bubble was asked to scroll itself.
    assert.deepEqual(scrolledPaths, ["src/keep/a.ts"]);
});

test("test_clicking_a_file_inside_the_selected_folder_still_scrolls_to_its_bubble", () => {
    // Scenario (the reported bug): selecting a folder filters the stage to it, and clicking one of
    // THAT folder's files must still land on the bubble — which is now one of the few the filtered
    // stage holds.
    // Steps:
    // open the page, select the `keep` folder, then click the leaf for src/keep/a.ts.
    openLayer1Page();
    findNavRow("summary.file-folder-name", "keep").click();
    scrolledPaths.length = 0;
    findNavRow(".file-item", "src/keep/a.ts").click();
    // its bubble was asked to scroll itself.
    assert.deepEqual(scrolledPaths, ["src/keep/a.ts"]);
});
