// Task 255: shift-clicking folders in the file tree (webapp/views/sidebar.ts) selects more than one
// at a time, and the click reports the UNION of every selected folder's files so the timeline can
// show all of them. The exclusive plain click of task 253 must survive alongside it.
//
// Rendered through renderFileNavInto with a spy rather than through the page: the behaviour under
// test is the tree's own click contract, and booting the page would drag in a stubbed NDJSON stream
// for no added coverage (the same reasoning as tests/layer1-folder-filter.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// All four share `src/`, which buildFileTree strips, leaving `keep`, `drop` and `other` as sibling
// folders and `deep` nested inside `keep` — so a multi-select has a nested subfolder to pull in, a
// second folder to add, and a third it must not reach.
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

// Off `window`, not the bare global: setupLayer1Dom publishes the happy-dom window and a hand-picked
// set of its constructors onto globalThis, and MouseEvent is not among them.
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
    // Scenario (task 255): shift-clicking adds a folder to the selection instead of replacing it,
    // so the timeline shows the files of BOTH — nested subfolders included, siblings excluded.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    assert.deepEqual([...reported[1]!].sort(), ["src/drop/c.ts", "src/keep/a.ts", "src/keep/deep/d.ts"]);
});

test("test_shift_clicking_a_second_folder_leaves_both_rows_marked_selected", async () => {
    // Scenario (task 255): the pane must SHOW both filters, otherwise the stage is filtered to two
    // folders while the nav claims one.
    const { container } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    assert.deepEqual(listSelectedFolderNames(container), ["drop", "keep"]);
});

test("test_shift_clicking_a_selected_folder_again_drops_only_that_folder", async () => {
    // Scenario (task 255): shift-click toggles, so releasing one of two selected folders must leave
    // the other one driving the filter rather than clearing everything.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    shiftClickFolder(container, "keep");
    assert.deepEqual(reported[2], ["src/drop/c.ts"]);
    assert.deepEqual(listSelectedFolderNames(container), ["drop"]);
});

test("test_a_plain_click_after_a_multi_select_replaces_the_whole_selection", async () => {
    // Scenario (task 255 guard): task 253's exclusive click must survive — a plain click on a third
    // folder drops both selected ones rather than joining them.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "drop");
    findFolderSummary(container, "other").click();
    assert.deepEqual(reported[2], ["src/other/e.ts"]);
    assert.deepEqual(listSelectedFolderNames(container), ["other"]);
});

test("test_a_selected_parent_and_child_folder_report_each_file_once", async () => {
    // Scenario (task 255): `deep` sits inside `keep`, so both selected at once overlap on d.ts. The
    // union is de-duplicated — a repeated path would be filtered twice downstream.
    const { container, reported } = await renderNavWithFolderSpy();
    findFolderSummary(container, "keep").click();
    shiftClickFolder(container, "deep");
    assert.deepEqual([...reported[1]!].sort(), ["src/keep/a.ts", "src/keep/deep/d.ts"]);
});
