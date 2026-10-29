// One Files-tree row: label, revision count, deleted mark, rename badge, and click selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { FileSidebarEntry, FileTreeNode } from "../webapp/views/sidebar.ts";

initLayer1Dom();

const NODE: FileTreeNode = { kind: "file", name: "a.ts", children: [], entry: undefined };

function makeEntry(overrides: Partial<FileSidebarEntry>): FileSidebarEntry {
    return { target: "src/a.ts", revisionCount: 3, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined, ...overrides };
}

async function renderLeaf(entry: FileSidebarEntry, opened: string[], reported: string[][]): Promise<{ root: HTMLElement; item: HTMLElement }> {
    const { renderFileTreeLeaf } = await import("../webapp/views/sidebar-file-leaf.ts");
    const root = document.createElement("div");
    const callbacks = { onFileClick: (target: string) => opened.push(target), onFolderClick: (targets: string[]) => reported.push(targets) };
    const item = renderFileTreeLeaf(NODE, entry, callbacks, root);
    root.append(item);
    return { root, item };
}

test("test_leaf_shows_label_revcount_and_deleted_tooltip", async () => {
    const { item } = await renderLeaf(makeEntry({ isDeleted: true }), [], []);
    assert.equal(item.className, "file-item deleted");
    assert.equal(item.title, "src/a.ts (deleted)");
    assert.equal(item.querySelector(".file-label")?.textContent, "a.ts");
    assert.equal(item.querySelector(".revcount")?.textContent, "(3)");
});

test("test_leaf_rename_badge_falls_back_to_the_original_basename", async () => {
    const { item } = await renderLeaf(makeEntry({ originalPath: "old/dir/b.ts" }), [], []);
    const badge = item.querySelector(".rename-badge") as HTMLElement;
    assert.equal(badge.textContent, "← b.ts");
    assert.equal(badge.title, "renamed from old/dir/b.ts");
});

test("test_leaf_click_selects_and_opens_but_shift_click_only_toggles", async () => {
    const opened: string[] = [];
    const reported: string[][] = [];
    const { item } = await renderLeaf(makeEntry({}), opened, reported);
    item.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    assert.deepEqual(opened, []);
    assert.deepEqual(reported, [["src/a.ts"]]);
    item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(opened, ["src/a.ts"]);
    assert.ok(item.classList.contains("selected"));
});
