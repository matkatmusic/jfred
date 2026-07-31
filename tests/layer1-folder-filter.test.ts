// Task 253: tests folder-click reporting via renderFileNavInto directly, skipping the page boot for no added coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// All three share `src/`, stripped by buildFileTree, leaving `keep`/`drop` siblings and `deep` nested in `keep` to test child+grandchild reach.
const NAV_VIEW = {
    pairs: [
        { path: "src/keep/a.ts", commits: [] },
        { path: "src/keep/deep/d.ts", commits: [] },
        { path: "src/drop/c.ts", commits: [] },
    ],
    gitOrphans: [],
    diskOrphans: [],
};

// Render the nav into a detached container, recording every folder selection it reports.
async function renderNavWithFolderSpy(): Promise<{ container: HTMLElement; reported: string[][] }> {
    const { renderFileNavInto, resetFileNavCollapseState } = await import("../webapp/layer1-filenav.ts");
    resetFileNavCollapseState();
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

test("test_clicking_a_folder_reports_every_file_at_or_below_it", () => {
    // Scenario (task 253): a folder stands for its own files and subfolder files, but nothing in a sibling folder.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        findFolderSummary(container, "keep").click();
        assert.deepEqual([...reported[0]!].sort(), ["src/keep/a.ts", "src/keep/deep/d.ts"]);
    });
});

test("test_clicking_a_folder_leaves_the_native_details_toggle_working", () => {
    // Task 253: a folder row's native <summary> toggle must survive the filter click.
    return renderNavWithFolderSpy().then(({ container }) => {
        // Off `window`, not the bare global: setupLayer1Dom only publishes a hand-picked set of constructors onto globalThis, excluding MouseEvent.
        const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
        findFolderSummary(container, "keep").dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
    });
});

test("test_clicking_the_selected_folder_again_reports_an_empty_selection", () => {
    // Scenario (task 253): re-clicking the active folder clears it; an empty list is what layer1-filter.ts reads as no filter.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        const keep = findFolderSummary(container, "keep");
        keep.click();
        keep.click();
        assert.deepEqual(reported[1], []);
    });
});

test("test_clicking_the_expand_triangle_does_not_select_the_folder", () => {
    // Scenario (task 253 follow-up): the expand triangle only opens/closes the folder; clicking it must not also filter the timeline.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        const toggle = findFolderSummary(container, "keep").querySelector(".file-folder-toggle");
        assert.ok(toggle !== null, "the folder row has no expand triangle to click");
        (toggle as HTMLElement).click();
        assert.deepEqual(reported, []);
        assert.equal(container.querySelectorAll(".selected").length, 0);
    });
});

test("test_selecting_a_folder_marks_only_that_row_selected", () => {
    // Scenario (task 253): only one folder drives the timeline at a time; selecting a second must release the first.
    return renderNavWithFolderSpy().then(({ container }) => {
        findFolderSummary(container, "keep").click();
        findFolderSummary(container, "drop").click();
        const selected = [...container.querySelectorAll(".selected")];
        assert.equal(selected.length, 1);
        assert.equal(selected[0]?.textContent, "drop");
    });
});

// Task 326: file rows join the nav-selection union that "Show Only Selected" filters by.
function findFileItem(container: HTMLElement, target: string): HTMLElement {
    const item = [...container.querySelectorAll<HTMLElement>(".file-item")]
        .find((candidate) => candidate.dataset.target === target);
    assert.ok(item !== undefined, `no File Nav file row for ${target}`);
    return item as HTMLElement;
}

test("test_plain_clicking_a_file_reports_just_that_file", () => {
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        findFileItem(container, "src/keep/a.ts").click();
        assert.deepEqual(reported[0], ["src/keep/a.ts"]);
    });
});

test("test_shift_clicking_files_accumulates_and_mixes_with_folders", () => {
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        const shiftClick = (element: HTMLElement) =>
            element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
        shiftClick(findFileItem(container, "src/keep/a.ts"));
        shiftClick(findFileItem(container, "src/drop/c.ts"));
        assert.deepEqual([...reported[1]!].sort(), ["src/drop/c.ts", "src/keep/a.ts"]);
        shiftClick(findFolderSummary(container, "keep"));
        assert.deepEqual([...reported[2]!].sort(), ["src/drop/c.ts", "src/keep/a.ts", "src/keep/deep/d.ts"]);
        // Shift-clicking a selected file removes it from the union.
        shiftClick(findFileItem(container, "src/drop/c.ts"));
        assert.deepEqual([...reported[3]!].sort(), ["src/keep/a.ts", "src/keep/deep/d.ts"]);
    });
});

test("test_shift_clicking_a_file_does_not_fire_the_file_open_callback", () => {
    return renderNavWithFolderSpy().then(({ container }) => {
        // The DOM is module-scoped, so an earlier test's open-report must be wiped before asserting silence.
        getRequiredElementById("find-status").textContent = "";
        findFileItem(container, "src/keep/a.ts")
            .dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
        // renderNavWithFolderSpy wires onFileClick to the real jump, which reports into #find-status.
        assert.equal(getRequiredElementById("find-status").textContent, "");
    });
});
