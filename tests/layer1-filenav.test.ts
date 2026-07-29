// Task 252: the Layer 1 File Nav must list EVERY identified file — the paired files, the repo files with no on-disk presence, and the on-disk files the repo does not have — using the webapp's existing file tree rather than a second one written for this page.
//
// The nav builder is called DIRECTLY rather than through a page boot: the behaviour under test is the payload -> entries mapping and the tree it renders, so a stubbed NDJSON stream would only widen the failure surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// One of each kind the endpoint returns. All three share `src/`, which buildFileTree STRIPS as the common prefix, so one path is nested a level deeper — otherwise the tree collapses to three root leaves and the folder assertion below would be testing the fixture rather than the renderer.
const NAV_VIEW = {
    pairs: [{ path: "src/kept.ts", commits: [{ hash: "a".repeat(40) }, { hash: "b".repeat(40) }] }],
    gitOrphans: [{ path: "src/nested/gone.ts" }],
    diskOrphans: [{ path: "src/untracked.ts" }],
};

async function renderNavIntoNewContainer(): Promise<HTMLElement> {
    const { renderFileNavInto } = await import("../webapp/layer1-filenav.ts");
    const container = document.createElement("div");
    // Folder clicks are tests/layer1-folder-filter.test.ts's subject; this file is about what the pane LISTS, so the selection callback is a no-op here.
    renderFileNavInto(container, NAV_VIEW, () => {});
    return container;
}

// Every leaf's full path — `title` is where the leaf renderer puts it (the visible text is the basename only).
function listLeafPaths(container: HTMLElement): string[] {
    return [...container.querySelectorAll(".file-item")]
        .map((leaf) => leaf.getAttribute("title") ?? "");
}

function findLeafTitled(container: HTMLElement, path: string): HTMLElement {
    const leaf = [...container.querySelectorAll(".file-item")]
        .find((item) => (item.getAttribute("title") ?? "").startsWith(path));
    assert.ok(leaf !== undefined, `no File Nav leaf for ${path}`);
    return leaf as HTMLElement;
}

test("test_every_identified_file_appears_in_the_file_nav", async () => {
    // Scenario (task 252): the pane lists all three kinds of identified file, including the ones with no current on-disk presence.  Steps: render the nav for a view holding one pair, one repo-only path and one disk-only path.
    const container = await renderNavIntoNewContainer();
    // all three paths are present as leaves.
    const paths = listLeafPaths(container).map((title) => title.replace(" (deleted)", ""));
    assert.deepEqual([...paths].sort(), ["src/kept.ts", "src/nested/gone.ts", "src/untracked.ts"]);
});

test("test_a_repo_file_with_no_on_disk_presence_renders_as_deleted", async () => {
    // Scenario (task 252): gitOrphans are in the repo tree and absent from disk, so they are the struck-through rows. The two orphan sets are mirror images, so a swap would be invisible without this assertion.  Steps: render the nav.
    const container = await renderNavIntoNewContainer();
    // the repo-only path is marked deleted.
    assert.ok(findLeafTitled(container, "src/nested/gone.ts").classList.contains("deleted"));
    // the paired file and the disk-only file are not — both exist on disk.
    assert.ok(!findLeafTitled(container, "src/kept.ts").classList.contains("deleted"));
    assert.ok(!findLeafTitled(container, "src/untracked.ts").classList.contains("deleted"));
});

test("test_a_pairs_commit_count_is_its_revision_count", async () => {
    // Scenario (task 252): Layer 1 has no revision ladder, so the count the shared leaf renders is the pair's commit count.  Steps: render the nav for a pair carrying two commits.
    const container = await renderNavIntoNewContainer();
    // the leaf shows that count.
    const count = findLeafTitled(container, "src/kept.ts").querySelector(".revcount");
    assert.equal(count?.textContent, "(2)");
});

test("test_the_nav_renders_folders_as_native_details", async () => {
    // Scenario (task 252): the pane must REUSE the existing tree, whose folders are native <details open> elements — a flat list quietly written for this page would fail here.  Steps: render the nav, one of whose paths sits a directory below the stripped common prefix.
    const container = await renderNavIntoNewContainer();
    // that directory is a folder row.
    const folders = [...container.querySelectorAll("details.file-folder")];
    assert.equal(folders.length, 1);
    assert.equal(folders[0]!.querySelector("summary")?.textContent, "nested");
});
