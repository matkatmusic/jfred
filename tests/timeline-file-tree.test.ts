// buildFileTree and findCommonDirectoryPrefix (timeline-file-tree.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyRenameBadgeLabels,
    buildFileTree,
    buildFilesSidebarViewModel,
    findCommonDirectoryPrefix,
} from "../webapp/views/timeline-file-tree.ts";
import { RENAME_EVENT_KIND, type WireTimelineDocument } from "../webapp/views/timeline-types.ts";

// A Files-pane entry for the tree tests: the target is what varies, the rest is uninteresting here.

function makeFileEntry(target: string, originalPath?: string) {
    return { target, revisionCount: 1, isDeleted: false, originalPath, renameBadgeLabel: undefined };
}

test("test_findCommonDirectoryPrefix_returns_the_directories_every_target_shares", () => {
    // Scenario: absolute targets share a long root; the tree strips it so files are readable.
    // Steps: two files in the same directory share that whole directory.
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/a.py", "/tmp/proj/src/b.py"]), "/tmp/proj/src");
});

test("test_findCommonDirectoryPrefix_stops_where_targets_diverge", () => {
    // Scenario: targets in sibling directories share only their parent.
    // Steps: /tmp/proj/src/a.py and /tmp/proj/docs/b.md share /tmp/proj.
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/a.py", "/tmp/proj/docs/b.md"]), "/tmp/proj");
});

test("test_findCommonDirectoryPrefix_compares_whole_segments_not_characters", () => {
    // Scenario: /foo/bar and /foo/barn share /foo, NOT /foo/bar — a character-wise prefix is a bug.
    // Steps: the two directories differ at their second segment despite the shared text "bar".
    assert.equal(findCommonDirectoryPrefix(["/foo/bar/a.py", "/foo/barn/b.py"]), "/foo");
});

test("test_findCommonDirectoryPrefix_uses_the_parent_directory_of_a_lone_target", () => {
    // Scenario: one file must not have its own name eaten by the prefix (that would empty the tree).
    // Steps: a single target contributes its directory, never its basename.
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/only.py"]), "/tmp/proj/src");
});

test("test_findCommonDirectoryPrefix_is_empty_when_targets_share_no_directory", () => {
    // Scenario: bare relative targets (the commit-walk fixture's shape) have no shared root.
    // Steps: alpha.py and beta.py sit at the root, so nothing is stripped.
    assert.equal(findCommonDirectoryPrefix(["alpha.py", "beta.py"]), "");
});

test("test_findCommonDirectoryPrefix_is_empty_for_no_targets", () => {
    // Scenario: an empty Files pane must not crash the tree builder.
    // Steps: no targets means no prefix.
    assert.equal(findCommonDirectoryPrefix([]), "");
});

test("test_buildFileTree_nests_each_file_under_its_directories", () => {
    // Scenario: the pane becomes a real tree — a folder node per directory, files as its leaves.
    // Steps:
    // build a tree from two files in different directories under a shared root.
    const tree = buildFileTree([makeFileEntry("/root/src/a.py"), makeFileEntry("/root/docs/b.md")]);
    // the shared /root prefix is stripped, leaving its two directories as the top level.
    assert.deepEqual(tree.map((node) => node.name), ["docs", "src"]);
    // each folder holds its own file, named by basename (never the full path).
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["b.md"]);
    assert.deepEqual(tree[1]!.children.map((child) => child.name), ["a.py"]);
});

test("test_buildFileTree_sorts_folders_before_files_then_alphabetically", () => {
    // Scenario: a stable, readable order — folders first, each group alphabetical.
    // Steps:
    // build a tree mixing root-level files with a folder, supplied out of order.
    const tree = buildFileTree([
        makeFileEntry("/root/zeta.py"),
        makeFileEntry("/root/alpha.py"),
        makeFileEntry("/root/src/nested.py"),
    ]);
    // the folder leads, then the two root files in alphabetical order.
    assert.deepEqual(tree.map((node) => node.name), ["src", "alpha.py", "zeta.py"]);
});

test("test_buildFileTree_carries_the_entry_facts_onto_each_leaf", () => {
    // Scenario: leaves must keep the full target (clicks route by full path) and the render facts.
    // Steps:
    // build a tree from one deleted, renamed file.
    const entry = {
        target: "/root/src/renamed.py",
        revisionCount: 2,
        isDeleted: true,
        originalPath: "/root/src/original.py",
        renameBadgeLabel: undefined,
    };
    const tree = buildFileTree([entry]);
    // the lone leaf carries the entry verbatim, so onFileClick still receives the full path.
    assert.deepEqual(tree[0]!.entry, entry);
});

test("test_buildFileTree_is_empty_for_no_files", () => {
    // Scenario: a project with no touched files renders an empty pane, not a crash.
    // Steps: no entries yields no nodes.
    assert.deepEqual(buildFileTree([]), []);
});

test("test_buildFileTree_strips_the_deep_absolute_root_real_targets_carry", () => {
    // Scenario: item 77's actual complaint — production targets are absolute and deep
    // (/private/var/folders/…/T/run-scenario.xxxx/alpha.py), so without stripping the shared root
    // the pane is a chain of single-child folders before the first real file.
    // Steps:
    // build a tree from two real-shaped absolute targets sharing their whole directory.
    const tree = buildFileTree([
        makeFileEntry("/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.9xxymp7j/alpha.py"),
        makeFileEntry("/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.9xxymp7j/beta.py"),
    ]);
    // the whole root collapses away: two readable basenames, no folder chain at all.
    assert.deepEqual(tree.map((node) => node.name), ["alpha.py", "beta.py"]);
});

test("test_buildFileTree_collapses_a_single_child_folder_chain_into_one_combined_node", () => {
    // Scenario: task 90 — in a multi-root project the shared prefix is shallow, so a real
    // single-child folder chain survives below it and costs one click per level. The chain
    // collapses into one combined `a/b/c` node; the root header itself is untouched.
    // Steps:
    // build a tree whose targets share only /Users/mm, leaving Programming -> jot-backup -> src.
    const tree = buildFileTree([
        makeFileEntry("/Users/mm/Programming/jot-backup/src/main.ts"),
        makeFileEntry("/Users/mm/Programming/jot-backup/src/util.ts"),
        makeFileEntry("/Users/mm/project/orders.py"),
    ]);
    // the chain renders as ONE combined node beside the branching sibling folder.
    assert.deepEqual(tree.map((node) => node.name), ["Programming/jot-backup/src", "project"]);
    // the combined node holds the chain's files directly.
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["main.ts", "util.ts"]);
    // a folder whose single child is a FILE does not merge that file into its name.
    assert.deepEqual(tree[1]!.children.map((child) => child.name), ["orders.py"]);
});

test("test_applyRenameBadgeLabels_keeps_basename_when_unique", () => {
    // Scenario: task 91 — badges only grow when they would collide; unique old basenames stay
    // bare, and a never-renamed entry gets no label at all.
    // Steps:
    // two renames from DIFFERENT old basenames, plus one never-renamed file.
    const entries = [
        makeFileEntry("/root/src/new_a.py", "/root/src/old_a.py"),
        makeFileEntry("/root/docs/new_b.py", "/root/docs/old_b.py"),
        makeFileEntry("/root/plain.py"),
    ];
    applyRenameBadgeLabels(entries);
    // unique basenames stay bare; the unrenamed entry stays unlabeled.
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["old_a.py", "old_b.py", undefined]);
});

test("test_applyRenameBadgeLabels_extends_to_shortest_distinguishing_suffix_on_collision", () => {
    // Scenario: task 91's actual complaint — two renames from the SAME old basename in different
    // directories render identical `← utils.py` badges; each must grow to the shortest suffix
    // that tells them apart.
    // Steps:
    // two renames whose old paths differ only at the parent directory.
    const entries = [
        makeFileEntry("/root/src/helpers.py", "/root/src/utils.py"),
        makeFileEntry("/root/docs/helpers.py", "/root/docs/utils.py"),
    ];
    applyRenameBadgeLabels(entries);
    // one extra segment is enough to distinguish them.
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["src/utils.py", "docs/utils.py"]);
});

test("test_applyRenameBadgeLabels_extends_past_equal_parent_segments", () => {
    // Scenario: the distinguishing segment can sit deeper than the immediate parent — depth must
    // keep growing until the suffixes actually differ, not stop after one segment.
    // Steps:
    // two renames whose old paths share basename AND parent, diverging one level higher.
    const entries = [
        makeFileEntry("/root/a/pkg/helpers.py", "/root/a/pkg/utils.py"),
        makeFileEntry("/root/b/pkg/helpers.py", "/root/b/pkg/utils.py"),
    ];
    applyRenameBadgeLabels(entries);
    // pkg/utils.py still collides, so both grow one more level.
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["a/pkg/utils.py", "b/pkg/utils.py"]);
});

test("test_buildFilesSidebarViewModel_stamps_rename_badge_labels", () => {
    // Scenario: the sidebar's producer applies the disambiguation itself — proving the labels
    // arrive stamped on the view model, not just that the helper works in isolation.
    // Steps:
    // a wire document with two histories renamed from same-basename old paths.
    const makeRenamedHistory = (target: string, from: string) => ({
        target,
        revisions: [{ kind: RENAME_EVENT_KIND, changeId: `toolu_${from}`, timestamp: "2026-07-01T10:00:00Z", rename: { from, to: target } }],
    });
    const document: WireTimelineDocument = {
        filesTouched: [
            makeRenamedHistory("/root/src/helpers.py", "/root/src/utils.py"),
            makeRenamedHistory("/root/docs/helpers.py", "/root/docs/utils.py"),
        ],
        rewoundFilesTouched: [],
        messages: [],
        steps: [],
        commitMarkers: [],
    };
    const entries = buildFilesSidebarViewModel(document);
    // both entries carry the disambiguated suffix labels.
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["src/utils.py", "docs/utils.py"]);
});

test("test_buildFileTree_stops_collapsing_at_a_branching_folder", () => {
    // Scenario: a chain merges only while each level holds exactly one folder — a folder with
    // two children is real structure and must keep its own row.
    // Steps:
    // build a tree where a -> b branches into left/ and right/ below the /Users/mm prefix.
    const tree = buildFileTree([
        makeFileEntry("/Users/mm/a/b/left/x.py"),
        makeFileEntry("/Users/mm/a/b/right/y.py"),
        makeFileEntry("/Users/mm/other/z.py"),
    ]);
    // the chain merges only down to the branching folder b.
    assert.deepEqual(tree.map((node) => node.name), ["a/b", "other"]);
    // b's two real subfolders survive as separate children.
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["left", "right"]);
});

test("test_buildFileTree_keeps_leaf_entries_intact_through_chain_collapse", () => {
    // Scenario: collapsing renames FOLDER nodes only — a leaf's entry must stay verbatim,
    // because clicks route by entry.target (the full untouched path).
    // Steps:
    // build a tree with one chained file and one flat file so the prefix stays /Users/mm.
    const chainedEntry = makeFileEntry("/Users/mm/deep/chain/file.py");
    const tree = buildFileTree([chainedEntry, makeFileEntry("/Users/mm/flat.py")]);
    // the chain collapses into one combined folder node.
    assert.equal(tree[0]!.name, "deep/chain");
    // its lone leaf still carries the entry verbatim.
    assert.deepEqual(tree[0]!.children[0]!.entry, chainedEntry);
});
