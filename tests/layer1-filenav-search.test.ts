// Task 281: the File Nav's own search box narrows the TREE as the user types, and its clear button
// puts every file back. It is not the find-bubble box: nothing here scrolls the timeline.
//
// The page-facing renderLayer1FileNav is the subject rather than renderFileNavInto, because the
// wiring IS the feature — the filter itself is one `includes` call, and a box nobody listened to
// would pass every assertion written against the renderer alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// The real layer1.html body, which is where #filenav-search and #filenav-search-clear live.
setupLayer1Dom();

// One of each kind the endpoint returns, sharing the `src/` prefix buildFileTree strips. `gone.ts`
// sits a directory deeper so a query can match across a folder boundary.
const NAV_VIEW = {
    pairs: [{ path: "src/kept.ts", commits: [{ hash: "a".repeat(40) }] }],
    gitOrphans: [{ path: "src/nested/gone.ts" }],
    diskOrphans: [{ path: "src/untracked.ts" }],
};

// Boot the pane against the page's own host elements. Folder clicks belong to
// tests/layer1-folder-filter.test.ts, so the selection callback is a no-op here.
async function bootFileNav(): Promise<void> {
    const { renderLayer1FileNav } = await import("../webapp/layer1-filenav.ts");
    renderLayer1FileNav(NAV_VIEW, () => {});
}

function searchBox(): HTMLInputElement {
    return document.getElementById("filenav-search") as HTMLInputElement;
}

// Type into the box the way a user does: set the value, then let the page's `input` handler run.
function typeIntoSearchBox(text: string): void {
    const box = searchBox();
    box.value = text;
    box.dispatchEvent(new window.Event("input"));
}

// Every leaf's full path — `title` is where the leaf renderer puts it (the visible text is the
// basename only), and a repo-only path carries a " (deleted)" suffix there.
function listLeafPaths(): string[] {
    const tree = document.getElementById("filenav-tree") as HTMLElement;
    return [...tree.querySelectorAll(".file-item")]
        .map((leaf) => (leaf.getAttribute("title") ?? "").replace(" (deleted)", ""))
        .sort();
}

test("test_typing_in_the_file_nav_search_box_leaves_only_matching_files", async () => {
    // Scenario (task 281): the tree filters as text is entered.
    // Steps:
    // boot the nav over all three paths.
    await bootFileNav();
    assert.equal(listLeafPaths().length, 3);
    // type a substring that only one path holds.
    typeIntoSearchBox("gone");
    // only that path is left.
    assert.deepEqual(listLeafPaths(), ["src/nested/gone.ts"]);
    // the match is case-insensitive and runs over the FULL path, not just the basename.
    typeIntoSearchBox("NESTED");
    assert.deepEqual(listLeafPaths(), ["src/nested/gone.ts"]);
    // a substring nothing holds empties the tree rather than falling back to everything.
    typeIntoSearchBox("no-such-file");
    assert.deepEqual(listLeafPaths(), []);
});

test("test_the_file_nav_search_clear_button_restores_every_file", async () => {
    // Scenario (task 281): the clear button empties the box AND resets the tree.
    // Steps:
    // boot the nav and filter it down to one file.
    await bootFileNav();
    typeIntoSearchBox("kept");
    assert.deepEqual(listLeafPaths(), ["src/kept.ts"]);
    // click the clear button.
    (document.getElementById("filenav-search-clear") as HTMLElement).click();
    // the box is empty and every file is listed again.
    assert.equal(searchBox().value, "");
    assert.deepEqual(listLeafPaths(), ["src/kept.ts", "src/nested/gone.ts", "src/untracked.ts"]);
});
