// One file row of the Files tree: basename label, revision count or coverage strip, rename badge, click selection.

import { createElement } from "../app-dom.ts";
import type { CoverageByTarget, FileSidebarEntry, FileTreeCallbacks, FileTreeNode } from "./sidebar.ts";
import { appendCoverageStrip } from "./sidebar-coverage.ts";
import { SELECTED_CLASS, clearFileSelectionIn, listSelectedNavTargets } from "./sidebar-selection.ts";

function getBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// Basename only, with the full path in the tooltip.
export function renderFileTreeLeaf(node: FileTreeNode, entry: FileSidebarEntry, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement, coverage?: CoverageByTarget): HTMLElement {
  // The name gets its own span so IT ellipsises, never the revcount after it.
  const item = createElement("div", {
    class: entry.isDeleted ? "file-item deleted" : "file-item",
    title: entry.isDeleted ? `${entry.target} (deleted)` : entry.target,
    "data-target": entry.target,
  }, [createElement("span", { class: "file-label", text: node.name })]);
  const segments = coverage?.get(entry.target);
  if (segments === undefined) {
    item.append(createElement("span", { class: "revcount", text: `(${entry.revisionCount})` }));
  }
  else {
    appendCoverageStrip(item, entry.target, segments);
  }
  if (entry.originalPath !== undefined) {
    item.append(createElement("span", {
      class: "rename-badge",
      text: `← ${entry.renameBadgeLabel ?? getBasename(entry.originalPath)}`,
      title: `renamed from ${entry.originalPath}`,
    }));
  }
  function selectFileRow(event: MouseEvent): void {
    // Shift toggles the row into the selection without opening its drawer.
    if (event.shiftKey) {
      item.classList.toggle(SELECTED_CLASS);
      callbacks.onFolderClick?.(listSelectedNavTargets(selectionRoot));
      return;
    }
    clearFileSelectionIn(selectionRoot);
    item.classList.add(SELECTED_CLASS);
    // Every selection change reports, so a stale folder filter never outlives its marks.
    callbacks.onFolderClick?.(listSelectedNavTargets(selectionRoot));
    callbacks.onFileClick(entry.target);
  }
  item.addEventListener("click", selectFileRow);
  return item;
}
