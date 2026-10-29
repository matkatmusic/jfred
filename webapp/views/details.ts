// Details pane (item 66): left-pane file list plus message and commit renderers.

import { createElement } from "../app-dom.ts";
import { openDetailsPane } from "../inspector-pane.ts";
import { computeCommitChangedFiles } from "./timeline-commit-files.ts";
import { applyRenameBadgeLabels } from "./timeline-file-badges.ts";
import { buildFileTree } from "./timeline-file-tree.ts";
import { buildFilesSidebarViewModel, type FileSidebarEntry } from "./timeline-file-tree-sidebar.ts";
import type { FileChange, TimelineNode } from "./timeline-node-types.ts";
import type { WireTimelineDocument } from "./timeline-wire-types.ts";
import { type DetailsContext, isChangeIdGitBaseline, computeDetailsHeaderText } from "./details-model.ts";
import { isFullContentsOn } from "./details-stored-choices.ts";
import { renderGitBaselineInDetails } from "./details-baseline.ts";
import {
  clearRightPaneBody,
  fetchRevisionDiffBlocks,
  hideDiffModeToggle,
  setDetailsHeader,
  setRightPaneLabel,
} from "./details-diff.ts";
import { renderRevisionDiffInDetails } from "./details-diff-revision.ts";
import { renderFileTreeNode, type FileTreeCallbacks } from "./sidebar.ts";

// Only this node's changed paths, deduped by path so a twice-edited file shows one leaf.
function buildTouchedFileEntries(changes: FileChange[], wireDocument: WireTimelineDocument): FileSidebarEntry[] {
  const sidebarEntriesByTarget = new Map<string, FileSidebarEntry>();
  for (const entry of buildFilesSidebarViewModel(wireDocument)) {
    sidebarEntriesByTarget.set(entry.target, entry);
  }
  const entriesByTarget = new Map<string, FileSidebarEntry>();
  for (const change of changes) {
    // Entries show the entry-time name; lookups stay keyed by the final path (task 127).
    const known = sidebarEntriesByTarget.get(change.path);
    if (known !== undefined) {
      entriesByTarget.set(change.path, { ...known, target: change.displayPath });
      continue;
    }
    entriesByTarget.set(change.path, {
      target: change.displayPath,
      revisionCount: 0,
      isDeleted: false,
      originalPath: change.renamedFrom,
      renameBadgeLabel: undefined,
    });
  }
  // Copies are mandatory: relabeling the sidebar's own entries corrupts its badges (task 91).
  const entries: FileSidebarEntry[] = [];
  for (const entry of entriesByTarget.values()) {
    entries.push({ ...entry });
  }
  applyRenameBadgeLabels(entries);
  return entries;
}

// Returned in DOM order so renderDetailsCommitMode clicks the first visible file (item 84).
// old:
// function appendFileList(left: HTMLElement, changes: FileChange[], context: DetailsContext): HTMLElement[] {
//     return changes.map((change) => {
//         const item = createElement("div", { class: "dfile", text: change.path });
//         // Re-callable so the full-contents toggle can re-fetch this file's diff at the
//         // current stored context width (item 75).
//         const showThisFileDiff = async () => {
//             const blocks = await fetchRevisionDiffBlocks(context.project, change.path, fullContentsIsOn());
//             await renderRevisionDiffInDetails(change, blocks, context.document.filesTouched, () => void showThisFileDiff());
//         };
//         item.onclick = async () => {
//             left.querySelectorAll(".dfile").forEach((other) => other.classList.remove("selected"));
//             item.classList.add("selected");
//             await showThisFileDiff();
//         };
//         left.append(item);
//         return item;
//     });
// }
function openClickedFileDiff(
  target: string,
  changeByPath: Map<string, FileChange>,
  openFileDiff: (change: FileChange) => Promise<void>,
): void {
  const change = changeByPath.get(target);
  if (change === undefined) {
    return;
  }
  void openFileDiff(change);
}

function appendFileList(left: HTMLElement, changes: FileChange[], context: DetailsContext): HTMLElement[] {
  // Keyed by displayPath since the tree echoes it back (task 127); last change per path wins.
  const changeByPath = new Map<string, FileChange>();
  for (const change of changes) {
    changeByPath.set(change.displayPath, change);
  }
  // Re-callable so the full-contents toggle can re-fetch this file's diff (item 75).
  const openFileDiff = async (change: FileChange) => {
    // task 56 follow-up: a base-commit beacon's diff is empty, so show the committed bytes.
    const isGitBaseline = isChangeIdGitBaseline(change.changeId);
    if (isGitBaseline) {
      renderGitBaselineInDetails(context.document, change.path, change.changeId!);
      return;
    }
    const blocks = await fetchRevisionDiffBlocks(context.project, change.path, isFullContentsOn());
    function openSameFileDiff(): void {
      void openFileDiff(change);
    }
    await renderRevisionDiffInDetails(change, blocks, context.document.filesTouched, openSameFileDiff);
  };
  const callbacks: FileTreeCallbacks = {
    onFileClick: (target: string) => {
      openClickedFileDiff(target, changeByPath, openFileDiff);
    },
  };
  for (const node of buildFileTree(buildTouchedFileEntries(changes, context.document))) {
    left.append(renderFileTreeNode(node, callbacks, left));
  }
  return [...left.querySelectorAll(".file-item")] as HTMLElement[];
}

export function renderDetailsMessageMode(node: TimelineNode, nodeIndex: number, context: DetailsContext): void {
  openDetailsPane();
  setDetailsHeader(computeDetailsHeaderText(node, { index: nodeIndex, total: context.nodes.length }));
  const left = document.getElementById("details-left")!;
  left.replaceChildren(createElement("div", { class: "pane-title", text: "Files touched" }));
  const changes = node.fileChanges ?? [];
  if (changes.length === 0) {
    left.append(createElement("div", { class: "dempty", text: "No files touched" }));
  }
  else {
    appendFileList(left, changes, context);
  }
  context.openNodeInspector(nodeIndex);
}

// "Changed files" means everything touched since the PREVIOUS commit.
export function renderDetailsCommitMode(node: TimelineNode, nodeIndex: number, context: DetailsContext): void {
  openDetailsPane();
  setDetailsHeader(computeDetailsHeaderText(node, { index: nodeIndex, total: context.nodes.length }));
  const left = document.getElementById("details-left")!;
  left.replaceChildren(createElement("div", { class: "pane-title", text: "Changed files" }));
  const changes = computeCommitChangedFiles(context.nodes, nodeIndex);
  if (changes.length === 0) {
    left.append(createElement("div", { class: "dempty", text: "No files changed" }));
    setRightPaneLabel("—");
    hideDiffModeToggle();
    clearRightPaneBody();
    return;
  }
  const items = appendFileList(left, changes, context);
  items[0]!.click();
}
