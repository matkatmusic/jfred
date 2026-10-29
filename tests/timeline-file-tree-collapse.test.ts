// buildFileTree single-child folder chain collapse (timeline-file-tree.ts) — wire-shape inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFileTree } from "../webapp/views/timeline-file-tree.ts";

function makeFileEntry(target: string, originalPath?: string) {
    return { target, revisionCount: 1, isDeleted: false, originalPath, renameBadgeLabel: undefined };
}

test("test_buildFileTree_collapses_a_single_child_folder_chain_into_one_combined_node", () => {
    // Task 90: a surviving single-child chain costs one click per level, so it collapses into one node.
    const tree = buildFileTree([
        makeFileEntry("/Users/mm/Programming/jot-backup/src/main.ts"),
        makeFileEntry("/Users/mm/Programming/jot-backup/src/util.ts"),
        makeFileEntry("/Users/mm/project/orders.py"),
    ]);
    assert.deepEqual(tree.map((node) => node.name), ["Programming/jot-backup/src", "project"]);
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["main.ts", "util.ts"]);
    // A folder whose single child is a FILE does not merge that file into its name.
    assert.deepEqual(tree[1]!.children.map((child) => child.name), ["orders.py"]);
});

test("test_buildFileTree_stops_collapsing_at_a_branching_folder", () => {
    // A chain merges only while each level holds exactly one folder; branching is real structure.
    const tree = buildFileTree([
        makeFileEntry("/Users/mm/a/b/left/x.py"),
        makeFileEntry("/Users/mm/a/b/right/y.py"),
        makeFileEntry("/Users/mm/other/z.py"),
    ]);
    assert.deepEqual(tree.map((node) => node.name), ["a/b", "other"]);
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["left", "right"]);
});

test("test_buildFileTree_keeps_leaf_entries_intact_through_chain_collapse", () => {
    // Collapsing renames FOLDER nodes only; leaf entries stay verbatim because clicks route by entry.target.
    const chainedEntry = makeFileEntry("/Users/mm/deep/chain/file.py");
    const tree = buildFileTree([chainedEntry, makeFileEntry("/Users/mm/flat.py")]);
    assert.equal(tree[0]!.name, "deep/chain");
    assert.deepEqual(tree[0]!.children[0]!.entry, chainedEntry);
});
