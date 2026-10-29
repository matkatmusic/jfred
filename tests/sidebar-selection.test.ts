// Files-tree selection helpers: descendant targets, the folder+file union, and clearing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { FileSidebarEntry, FileTreeNode } from "../webapp/views/sidebar.ts";

initLayer1Dom();

function makeEntry(target: string): FileSidebarEntry {
    return { target, revisionCount: 1, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined };
}

function makeLeaf(name: string, target: string): FileTreeNode {
    return { kind: "file", name, children: [], entry: makeEntry(target) };
}

test("test_listDescendantTargets_returns_leaf_targets_in_tree_order", async () => {
    const { listDescendantTargets } = await import("../webapp/views/sidebar-selection.ts");
    const folder: FileTreeNode = {
        kind: "folder",
        name: "src",
        entry: undefined,
        children: [
            makeLeaf("a.ts", "src/a.ts"),
            { kind: "folder", name: "deep", entry: undefined, children: [makeLeaf("d.ts", "src/deep/d.ts")] },
            makeLeaf("b.ts", "src/b.ts"),
        ],
    };
    assert.deepEqual(listDescendantTargets(folder), ["src/a.ts", "src/deep/d.ts", "src/b.ts"]);
});

test("test_listSelectedNavTargets_unions_selected_folder_and_file_rows", async () => {
    const { listSelectedNavTargets, folderTargetsBySummary, clearFileSelectionIn } = await import("../webapp/views/sidebar-selection.ts");
    const root = document.createElement("div");
    root.innerHTML = '<summary class="file-folder-name selected"></summary><div class="file-item selected" data-target="x/y.ts"></div><div class="file-item" data-target="x/n.ts"></div>';
    folderTargetsBySummary.set(root.querySelector("summary") as HTMLElement, ["x/y.ts", "x/z.ts"]);
    assert.deepEqual(listSelectedNavTargets(root), ["x/y.ts", "x/z.ts"]);
    clearFileSelectionIn(root);
    assert.deepEqual(listSelectedNavTargets(root), []);
});
