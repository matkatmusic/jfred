// Selection state of the Files tree: the `selected` class on rows is the only state.

import type { FileTreeNode } from "./sidebar.ts";

export const SELECTED_CLASS = "selected";

export const FOLDER_NAME_CLASS = "file-folder-name";

// A WeakMap, so a discarded tree's entries go with it.
export const folderTargetsBySummary = new WeakMap<HTMLElement, string[]>();

// The root is explicit so a click in one on-screen tree cannot clear the other's selection.
export function clearFileSelectionIn(root: HTMLElement): void {
  for (const item of root.querySelectorAll(`.${SELECTED_CLASS}`)) {
    item.classList.remove(SELECTED_CLASS);
  }
}

// De-duplicated because a selected parent and child folder overlap.
function listSelectedFolderTargets(selectionRoot: HTMLElement): string[] {
  const union = new Set<string>();
  for (const summary of selectionRoot.querySelectorAll(`.${FOLDER_NAME_CLASS}.${SELECTED_CLASS}`)) {
    for (const target of folderTargetsBySummary.get(summary as HTMLElement) ?? []) {
      union.add(target);
    }
  }
  return [...union];
}

// Selected file rows join the folder union so both feed one nav-selection filter.
export function listSelectedNavTargets(selectionRoot: HTMLElement): string[] {
  const fileTargets: string[] = [];
  for (const item of selectionRoot.querySelectorAll<HTMLElement>(`.file-item.${SELECTED_CLASS}`)) {
    fileTargets.push(item.dataset.target ?? "");
  }
  return [...new Set([...listSelectedFolderTargets(selectionRoot), ...fileTargets])];
}

// Recurses on `entry` rather than `kind`, since `entry` is what the leaf renderer requires.
export function listDescendantTargets(node: FileTreeNode): string[] {
  if (node.entry !== undefined) {
    return [node.entry.target];
  }
  const targets: string[] = [];
  for (const child of node.children) {
    targets.push(...listDescendantTargets(child));
  }
  return targets;
}
