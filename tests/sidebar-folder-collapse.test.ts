// Task 332: renderFileTreeNode's optional collapse tracking, tested in isolation from any caller.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFileTreeNode, type FolderCollapseState } from "../webapp/views/sidebar.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// A two-level fixture: "src" contains folder "nested", which contains one file leaf.
const LEAF_ENTRY = { target: "src/nested/leaf.ts", revisionCount: 1, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined };
const LEAF_NODE = { kind: "file", name: "leaf.ts", children: [], entry: LEAF_ENTRY };
const NESTED_FOLDER = { kind: "folder", name: "nested", children: [LEAF_NODE], entry: undefined };
const ROOT_FOLDER = { kind: "folder", name: "src", children: [NESTED_FOLDER], entry: undefined };

const CALLBACKS = { onFileClick: () => {} };

function findDetailsNamed(root: HTMLElement, name: string): HTMLDetailsElement {
    const summary = [...root.querySelectorAll("summary.file-folder-name")]
        .find((candidate) => candidate.textContent === name);
    assert.ok(summary !== undefined, `no folder named ${name}`);
    return (summary as HTMLElement).parentElement as HTMLDetailsElement;
}

test("test_no_collapse_argument_leaves_every_folder_open", () => {
    const root = document.createElement("div");
    root.append(renderFileTreeNode(ROOT_FOLDER, CALLBACKS, root));
    assert.ok(findDetailsNamed(root, "src").hasAttribute("open"));
    assert.ok(findDetailsNamed(root, "nested").hasAttribute("open"));
});

test("test_a_path_named_in_collapsedPaths_renders_that_folder_closed", () => {
    const root = document.createElement("div");
    const collapse: FolderCollapseState = { collapsedPaths: new Set(["src/nested"]), onToggle: () => {} };
    root.append(renderFileTreeNode(ROOT_FOLDER, CALLBACKS, root, undefined, collapse));
    assert.ok(!findDetailsNamed(root, "nested").hasAttribute("open"));
    assert.ok(findDetailsNamed(root, "src").hasAttribute("open"));
});

test("test_closing_a_folder_reports_its_full_path_and_the_closed_state", () => {
    const root = document.createElement("div");
    const reported: [string, boolean][] = [];
    const collapse: FolderCollapseState = { collapsedPaths: new Set(), onToggle: (path, isOpen) => reported.push([path, isOpen]) };
    root.append(renderFileTreeNode(ROOT_FOLDER, CALLBACKS, root, undefined, collapse));
    const details = findDetailsNamed(root, "src");
    details.open = false;
    assert.deepEqual(reported, [["src", false]]);
});

test("test_opening_a_previously_collapsed_folder_reports_the_open_state", () => {
    const root = document.createElement("div");
    const reported: [string, boolean][] = [];
    const collapse: FolderCollapseState = {
        collapsedPaths: new Set(["src/nested"]),
        onToggle: (path, isOpen) => reported.push([path, isOpen]),
    };
    root.append(renderFileTreeNode(ROOT_FOLDER, CALLBACKS, root, undefined, collapse));
    const details = findDetailsNamed(root, "nested");
    details.open = true;
    assert.deepEqual(reported, [["src/nested", true]]);
});

test("test_a_nested_folder_path_joins_parent_and_child_names_with_a_slash", () => {
    const root = document.createElement("div");
    const reported: [string, boolean][] = [];
    const collapse: FolderCollapseState = { collapsedPaths: new Set(), onToggle: (path, isOpen) => reported.push([path, isOpen]) };
    root.append(renderFileTreeNode(ROOT_FOLDER, CALLBACKS, root, undefined, collapse));
    const details = findDetailsNamed(root, "nested");
    details.open = false;
    assert.deepEqual(reported, [["src/nested", false]]);
});
