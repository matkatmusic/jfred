// Task 253: clicking a folder in the Layer 1 File Nav must report that folder's files so the page
// can filter the timeline to them. This file covers the CLICK half — which files a folder stands
// for, that re-clicking it clears the selection, and that the native <details> toggle survives.
// The view transform the reported targets drive is tests/layer1-filter.test.ts.
//
// Rendered through renderFileNavInto with a spy rather than through the page: the behaviour under
// test is the tree's own click contract, and booting the page would drag in a stubbed NDJSON stream
// for no added coverage (the same reasoning as tests/layer1-filenav.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// All three share `src/`, which buildFileTree strips, leaving `keep` and `drop` as sibling folders
// and `deep` nested inside `keep` — so a click on `keep` has both a direct child and a grandchild to
// find, and a sibling folder it must not reach into.
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

test("test_clicking_a_folder_reports_every_file_at_or_below_it", () => {
    // Scenario (task 253): a folder stands for its own files AND every file in its subfolders, and
    // for nothing in a sibling folder.
    // Steps:
    // render the nav and click the `keep` folder.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        findFolderSummary(container, "keep").click();
        // both files under it are reported, the nested one included, and the sibling's is not.
        assert.deepEqual([...reported[0]!].sort(), ["src/keep/a.ts", "src/keep/deep/d.ts"]);
    });
});

test("test_clicking_a_folder_leaves_the_native_details_toggle_working", () => {
    // Scenario (task 253): a folder row is a native <summary>, whose DEFAULT ACTION is opening and
    // closing its <details>. Filtering must not be bought by cancelling that.
    // Steps:
    // render the nav and dispatch a cancelable click on the `keep` folder.
    return renderNavWithFolderSpy().then(({ container }) => {
        // Off `window`, not the bare global: setupLayer1Dom publishes the happy-dom window and a
        // hand-picked set of its constructors onto globalThis, and MouseEvent is not among them.
        const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
        findFolderSummary(container, "keep").dispatchEvent(event);
        // the handler let the default action stand.
        assert.equal(event.defaultPrevented, false);
    });
});

test("test_clicking_the_selected_folder_again_reports_an_empty_selection", () => {
    // Scenario (task 253): re-clicking the folder that is already driving the filter clears it. An
    // empty list is what webapp/layer1-filter.ts reads as "no filter".
    // Steps:
    // render the nav and click the same folder twice.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        const keep = findFolderSummary(container, "keep");
        keep.click();
        keep.click();
        // the second click reported nothing selected.
        assert.deepEqual(reported[1], []);
    });
});

test("test_clicking_the_expand_triangle_does_not_select_the_folder", () => {
    // Scenario (task 253 follow-up): the triangle's only job is opening and closing the folder.
    // Reaching for it to see what is inside must not also filter the timeline to it.
    // Steps:
    // render the nav and click the `keep` folder's triangle rather than its name.
    return renderNavWithFolderSpy().then(({ container, reported }) => {
        const toggle = findFolderSummary(container, "keep").querySelector(".file-folder-toggle");
        assert.ok(toggle !== null, "the folder row has no expand triangle to click");
        (toggle as HTMLElement).click();
        // nothing was selected and nothing was reported.
        assert.deepEqual(reported, []);
        assert.equal(container.querySelectorAll(".selected").length, 0);
    });
});

test("test_selecting_a_folder_marks_only_that_row_selected", () => {
    // Scenario (task 253): one folder drives the timeline at a time, so selecting a second must
    // release the first — otherwise the pane shows two filters and the stage shows one.
    // Steps:
    // render the nav, click `keep`, then click `drop`.
    return renderNavWithFolderSpy().then(({ container }) => {
        findFolderSummary(container, "keep").click();
        findFolderSummary(container, "drop").click();
        // exactly one row is marked, and it is the second folder.
        const selected = [...container.querySelectorAll(".selected")];
        assert.equal(selected.length, 1);
        assert.equal(selected[0]?.textContent, "drop");
    });
});
