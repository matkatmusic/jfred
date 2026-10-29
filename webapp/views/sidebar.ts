// Renders the "Sessions" and "Files" panes into #drawer; clicks route back to the timeline through callbacks.

import { createElement } from "../app-dom.ts";
import type { CoverageSegment } from "./reconstruction-coverage.ts";
import { renderFileTreeLeaf } from "./sidebar-file-leaf.ts";
import { FOLDER_NAME_CLASS, SELECTED_CLASS, clearFileSelectionIn, folderTargetsBySummary, listDescendantTargets, listSelectedNavTargets } from "./sidebar-selection.ts";

// Files with full coverage are absent, keeping the plain revision count on their rows.
export type CoverageByTarget = Map<string, CoverageSegment[]>;

type SessionSidebarEntry = {
  sessionId: string;
  shortLabel: string;
  jsonlFileName: string | undefined;
  rowCount: number;
  firstNodeIndex: number;
};

export type FileSidebarEntry = {
  target: string;
  revisionCount: number;
  // True only when the file's LAST revision is a delete; the leaf renders struck-through.
  isDeleted: boolean;
  // Where a renamed file was born; undefined when it was never renamed.
  originalPath: string | undefined;
  renameBadgeLabel: string | undefined;
};

// Mirrored, not imported: timeline.ts imports this module, so importing back would be a cycle.
export type FileTreeNode = {
  kind: string;
  name: string;
  children: FileTreeNode[];
  entry: FileSidebarEntry | undefined;
};

const FOLDER_NODE_KIND = "folder";

// The narrower half of ForkSidebarCallbacks: two panes render the SAME tree with different click meanings.
export type FileTreeCallbacks = {
  onFileClick: (target: string) => void;
  // Gets the union of selected leaf paths (empty = cleared); folders stay inert when omitted.
  onFolderClick?: (targets: string[]) => void;
};

type ForkSidebarCallbacks = FileTreeCallbacks & {
  onSessionClick: (firstNodeIndex: number) => void;
};

function appendSessionItem(drawer: HTMLElement, session: SessionSidebarEntry, callbacks: ForkSidebarCallbacks): void {
  const item = createElement("div", { class: "session-item", title: session.jsonlFileName ?? session.sessionId }, [
    createElement("div", { class: "sess-file", text: `${session.shortLabel}….jsonl` }),
    createElement("div", { class: "sess-meta" }, [
      createElement("span", { class: "sess-uuid", text: session.shortLabel }),
      ` · ${session.rowCount} rows`,
    ]),
  ]);
  function selectSession(): void {
    callbacks.onSessionClick(session.firstNodeIndex);
  }
  item.addEventListener("click", selectSession);
  drawer.append(item);
}

export function renderForkSidebar(drawer: HTMLElement, sessions: SessionSidebarEntry[], files: FileTreeNode[], callbacks: ForkSidebarCallbacks, coverage: CoverageByTarget): void {
  drawer.replaceChildren();
  drawer.append(createElement("div", { class: "pane-title", text: "Sessions" }));
  for (const session of sessions) {
    appendSessionItem(drawer, session, callbacks);
  }
  drawer.append(createElement("div", { class: "pane-title", text: "Files" }));
  for (const node of files) {
    drawer.append(renderFileTreeNode(node, callbacks, drawer, coverage));
  }
}

// Task 332: only the File Nav passes this; the other two callers keep every folder always open.
export type FolderCollapseState = {
  collapsedPaths: ReadonlySet<string>;
  onToggle: (folderPath: string, isOpen: boolean) => void;
};

// A native <details> per folder; open by default unless a passed-in collapse state says otherwise.
export function renderFileTreeNode(
  node: FileTreeNode,
  callbacks: FileTreeCallbacks,
  selectionRoot: HTMLElement,
  coverage?: CoverageByTarget,
  collapse?: FolderCollapseState,
  path: string = "",
): HTMLElement {
  if (node.kind === FOLDER_NODE_KIND) {
    // Full path from the stripped root; node.name alone is only this one level's segment.
    const folderPath = path === "" ? node.name : `${path}/${node.name}`;
    const childElements: HTMLElement[] = [];
    for (const child of node.children) {
      childElements.push(renderFileTreeNode(child, callbacks, selectionRoot, coverage, collapse, folderPath));
    }
    const kids = createElement("div", { class: "file-folder-kids" }, childElements);
    const summary = createElement("summary", { class: FOLDER_NAME_CLASS, text: node.name });
    attachFolderClick(summary, node, callbacks, selectionRoot);
    const isOpen = !(collapse?.collapsedPaths.has(folderPath) ?? false);
    return createElement("details", {
      class: "file-folder",
      open: isOpen ? "" : undefined,
      ontoggle: collapse === undefined ? undefined :
        (event: Event) => collapse.onToggle(folderPath, (event.currentTarget as HTMLDetailsElement).open),
    }, [summary, kids]);
  }
  return renderFileTreeLeaf(node, node.entry!, callbacks, selectionRoot, coverage);
}

// NO preventDefault: cancelling a <summary> click would trade expand/collapse for the filter.
function attachFolderClick(summary: HTMLElement, node: FileTreeNode, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement): void {
  const onFolderClick = callbacks.onFolderClick;
  if (onFolderClick === undefined) {
    return;
  }
  // A REAL element, not a ::before pseudo-element, so `event.target` can distinguish a click on it.
  const toggle = createElement("span", { class: "file-folder-toggle" });
  summary.prepend(toggle);
  folderTargetsBySummary.set(summary, listDescendantTargets(node));
  function selectFolder(event: MouseEvent): void {
    // Returning early rather than cancelling: expanding is this click's default action anyway.
    if (event.target === toggle) {
      return;
    }
    const wasSelected = summary.classList.contains(SELECTED_CLASS);
    // A shift-click adds to the selection instead of replacing it.
    if (!event.shiftKey) {
      clearFileSelectionIn(selectionRoot);
    }
    summary.classList.toggle(SELECTED_CLASS, !wasSelected);
    onFolderClick!(listSelectedNavTargets(selectionRoot));
  }
  summary.addEventListener("click", selectFolder);
}
