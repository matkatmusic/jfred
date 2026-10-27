// buildFileTree and findCommonDirectoryPrefix (timeline-file-tree.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRenameBadgeLabels } from "../webapp/views/timeline-file-badges.ts";
import { buildFileTree, findCommonDirectoryPrefix } from "../webapp/views/timeline-file-tree.ts";
import { buildFilesSidebarViewModel } from "../webapp/views/timeline-file-tree-sidebar.ts";
import { RENAME_EVENT_KIND, type WireTimelineDocument } from "../webapp/views/timeline-types.ts";


function makeFileEntry(target: string, originalPath?: string) {
    return { target, revisionCount: 1, isDeleted: false, originalPath, renameBadgeLabel: undefined };
}

test("test_findCommonDirectoryPrefix_returns_the_directories_every_target_shares", () => {
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/a.py", "/tmp/proj/src/b.py"]), "/tmp/proj/src");
});

test("test_findCommonDirectoryPrefix_stops_where_targets_diverge", () => {
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/a.py", "/tmp/proj/docs/b.md"]), "/tmp/proj");
});

test("test_findCommonDirectoryPrefix_compares_whole_segments_not_characters", () => {
    // /foo/bar and /foo/barn share /foo only — a character-wise prefix would be a bug.
    assert.equal(findCommonDirectoryPrefix(["/foo/bar/a.py", "/foo/barn/b.py"]), "/foo");
});

test("test_findCommonDirectoryPrefix_uses_the_parent_directory_of_a_lone_target", () => {
    // A lone target must not have its own basename eaten by the prefix, which would empty the tree.
    assert.equal(findCommonDirectoryPrefix(["/tmp/proj/src/only.py"]), "/tmp/proj/src");
});

test("test_findCommonDirectoryPrefix_is_empty_when_targets_share_no_directory", () => {
    assert.equal(findCommonDirectoryPrefix(["alpha.py", "beta.py"]), "");
});

test("test_findCommonDirectoryPrefix_is_empty_for_no_targets", () => {
    assert.equal(findCommonDirectoryPrefix([]), "");
});

test("test_buildFileTree_nests_each_file_under_its_directories", () => {
    const tree = buildFileTree([makeFileEntry("/root/src/a.py"), makeFileEntry("/root/docs/b.md")]);
    assert.deepEqual(tree.map((node) => node.name), ["docs", "src"]);
    assert.deepEqual(tree[0]!.children.map((child) => child.name), ["b.md"]);
    assert.deepEqual(tree[1]!.children.map((child) => child.name), ["a.py"]);
});

test("test_buildFileTree_sorts_folders_before_files_then_alphabetically", () => {
    const tree = buildFileTree([
        makeFileEntry("/root/zeta.py"),
        makeFileEntry("/root/alpha.py"),
        makeFileEntry("/root/src/nested.py"),
    ]);
    assert.deepEqual(tree.map((node) => node.name), ["src", "alpha.py", "zeta.py"]);
});

test("test_buildFileTree_carries_the_entry_facts_onto_each_leaf", () => {
    // Leaves must keep the full target because clicks route by entry.target.
    const entry = {
        target: "/root/src/renamed.py",
        revisionCount: 2,
        isDeleted: true,
        originalPath: "/root/src/original.py",
        renameBadgeLabel: undefined,
    };
    const tree = buildFileTree([entry]);
    assert.deepEqual(tree[0]!.entry, entry);
});

test("test_buildFileTree_is_empty_for_no_files", () => {
    assert.deepEqual(buildFileTree([]), []);
});

test("test_buildFileTree_strips_the_deep_absolute_root_real_targets_carry", () => {
    // Item 77: production targets are absolute and deep, so an unstripped root is a chain of single-child folders.
    const tree = buildFileTree([
        makeFileEntry("/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.9xxymp7j/alpha.py"),
        makeFileEntry("/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.9xxymp7j/beta.py"),
    ]);
    assert.deepEqual(tree.map((node) => node.name), ["alpha.py", "beta.py"]);
});

test("test_applyRenameBadgeLabels_keeps_basename_when_unique", () => {
    // Task 91: badges only grow when they would collide.
    const entries = [
        makeFileEntry("/root/src/new_a.py", "/root/src/old_a.py"),
        makeFileEntry("/root/docs/new_b.py", "/root/docs/old_b.py"),
        makeFileEntry("/root/plain.py"),
    ];
    applyRenameBadgeLabels(entries);
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["old_a.py", "old_b.py", undefined]);
});

test("test_applyRenameBadgeLabels_extends_to_shortest_distinguishing_suffix_on_collision", () => {
    // Task 91: same old basename in two directories would render identical badges.
    const entries = [
        makeFileEntry("/root/src/helpers.py", "/root/src/utils.py"),
        makeFileEntry("/root/docs/helpers.py", "/root/docs/utils.py"),
    ];
    applyRenameBadgeLabels(entries);
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["src/utils.py", "docs/utils.py"]);
});

test("test_applyRenameBadgeLabels_extends_past_equal_parent_segments", () => {
    // Depth must keep growing until suffixes differ, not stop after one segment.
    const entries = [
        makeFileEntry("/root/a/pkg/helpers.py", "/root/a/pkg/utils.py"),
        makeFileEntry("/root/b/pkg/helpers.py", "/root/b/pkg/utils.py"),
    ];
    applyRenameBadgeLabels(entries);
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["a/pkg/utils.py", "b/pkg/utils.py"]);
});

test("test_buildFilesSidebarViewModel_stamps_rename_badge_labels", () => {
    // Proves the sidebar producer applies the disambiguation itself, not just the helper in isolation.
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
    assert.deepEqual(entries.map((entry) => entry.renameBadgeLabel), ["src/utils.py", "docs/utils.py"]);
});
