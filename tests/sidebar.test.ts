// Task 255: shift-click multi-selects folders in the file tree; click reports the union of their files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// `keep`, `drop`, `other` are sibling folders; `deep` nests inside `keep` for multi-select coverage.
const NAV_VIEW = {
    pairs: [
        { path: "src/keep/a.ts", commits: [] },
        { path: "src/keep/deep/d.ts", commits: [] },
        { path: "src/drop/c.ts", commits: [] },
        { path: "src/other/e.ts", commits: [] },
    ],
    gitOrphans: [],
    diskOrphans: [],
};

// Render the nav into a detached container, recording every folder selection it reports.
async function renderNavWithFolderSpy(): Promise<{ container: HTMLElement; reported: string[][] }> {
    const { renderFileNavInto } = await import("../webapp/layer1-filenav.ts");
    const container = document.createElement("div");
    const reported: string[][] = [];
    renderFileNavInto(container, NAV_VIEW, (targets) => reported.push(targets));
    return { container, reported };
}

function findFolderSummary(container: HTMLElement, name: string): HTMLElement {
    const summary = [...container.querySelectorAll("summary.file-folder-name")]
        .find((candidate) => candidate.textContent === name);
    assert.ok(summary !== undefined, `no File Nav folder named ${name}`);
    return summary as HTMLElement;
}

// Off `window`: setupLayer1Dom's hand-picked globalThis constructors don't include MouseEvent.
function shiftClickFolder(container: HTMLElement, name: string): void {
    findFolderSummary(container, name).dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }),
    );
}

function listSelectedFolderNames(container: HTMLElement): string[] {
    return [...container.querySelectorAll("summary.file-folder-name.selected")]
        .map((summary) => summary.textContent ?? "")
        .sort();
}

test("test_shift_clicking_a_second_folder_reports_the_union_of_both_folders_files", async () => {
    // Scenario (task 255): shift-click adds a folder to the selection; union includes nested subfolders.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    assert.deepEqual([...reported[1]!].sort(), ["src/drop/c.ts", "src/keep/a.ts", "src/keep/deep/d.ts"]);
});

test("test_shift_clicking_a_second_folder_leaves_both_rows_marked_selected", async () => {
    // Scenario (task 255): the pane must show both filters, matching what the nav claims selected.
    const { container } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    assert.deepEqual(listSelectedFolderNames(container), ["drop", "keep"]);
});

test("test_shift_clicking_a_selected_folder_again_drops_only_that_folder", async () => {
    // Scenario (task 255): shift-click toggles off one folder, leaving the other still driving the filter.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    shiftClickFolder(container, "keep");
    assert.deepEqual(reported[2], ["src/drop/c.ts"]);
    assert.deepEqual(listSelectedFolderNames(container), ["drop"]);
});

test("test_a_plain_click_after_a_multi_select_replaces_the_whole_selection", async () => {
    // Scenario (task 255 guard): task 253's plain click must still replace, not join, the selection.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    findFolderSummary(container, "other").click();
    assert.deepEqual(reported[2], ["src/other/e.ts"]);
    assert.deepEqual(listSelectedFolderNames(container), ["other"]);
});

test("test_a_selected_parent_and_child_folder_report_each_file_once", async () => {
    // Scenario (task 255): `deep` sits inside `keep`, so selecting both must de-duplicate the overlapping file.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "deep");
    assert.deepEqual([...reported[1]!].sort(), ["src/keep/a.ts", "src/keep/deep/d.ts"]);
});
