// Renders the "Sessions" and "Files" panes into #drawer; clicks route back to the timeline through callbacks.

import { el } from "../app-dom.ts";
import type { CoverageSegment } from "./reconstruction-coverage.ts";
import { appendCoverageStrip } from "./sidebar-coverage.ts";

// Files with full coverage are absent, keeping the plain revision count on their rows.
type CoverageByTarget = Map<string, CoverageSegment[]>;

type SessionSidebarEntry = {
    sessionId: string;
    shortLabel: string;
    jsonlFileName: string | undefined;
    rowCount: number;
    firstNodeIndex: number;
};

type FileSidebarEntry = {
    target: string;
    revisionCount: number;
    // True only when the file's LAST revision is a delete; the leaf renders struck-through.
    isDeleted: boolean;
    // Where a renamed file was born; undefined when it was never renamed.
    originalPath: string | undefined;
    renameBadgeLabel: string | undefined;
};

// Mirrored, not imported: timeline.ts imports this module, so importing back would be a cycle.
type FileTreeNode = {
    kind: string;
    name: string;
    children: FileTreeNode[];
    entry: FileSidebarEntry | undefined;
};

const FOLDER_NODE_KIND = "folder";

const SELECTED_CLASS = "selected";

const FOLDER_NAME_CLASS = "file-folder-name";

// A WeakMap, so the `selected` class stays the only selection state and a discarded tree's entries go with it.
const folderTargetsBySummary = new WeakMap<HTMLElement, string[]>();

// The narrower half of ForkSidebarCallbacks: two panes render the SAME tree with different click meanings.
export type FileTreeCallbacks = {
    onFileClick: (target: string) => void;
    // Receives the de-duplicated union of every selected folder's LEAF paths; empty means cleared.

    // Optional: folders stay inert for owners that pass nothing.
    onFolderClick?: (targets: string[]) => void;
};

type ForkSidebarCallbacks = FileTreeCallbacks & {
    onSessionClick: (firstNodeIndex: number) => void;
};

// The root is explicit so a click in one on-screen tree cannot clear the other's selection.
export function clearFileSelectionIn(root: HTMLElement): void {
    for (const item of root.querySelectorAll(`.${SELECTED_CLASS}`)) {
        item.classList.remove(SELECTED_CLASS);
    }
}

function appendSessionItem(drawer: HTMLElement, session: SessionSidebarEntry, callbacks: ForkSidebarCallbacks): void {
    const item = el("div", { class: "session-item", title: session.jsonlFileName ?? session.sessionId }, [
        el("div", { class: "sess-file", text: `${session.shortLabel}….jsonl` }),
        el("div", { class: "sess-meta" }, [
            el("span", { class: "sess-uuid", text: session.shortLabel }),
            ` · ${session.rowCount} rows`,
        ]),
    ]);
    item.addEventListener("click", () => callbacks.onSessionClick(session.firstNodeIndex));
    drawer.append(item);
}

export function renderForkSidebar(drawer: HTMLElement, sessions: SessionSidebarEntry[], files: FileTreeNode[], callbacks: ForkSidebarCallbacks, coverage: CoverageByTarget): void {
    drawer.replaceChildren();
    drawer.append(el("div", { class: "pane-title", text: "Sessions" }));
    for (const session of sessions) {
        appendSessionItem(drawer, session, callbacks);
    }
    drawer.append(el("div", { class: "pane-title", text: "Files" }));
    for (const node of files) {
        drawer.append(renderFileTreeNode(node, callbacks, drawer, coverage));
    }
}

// A native <details open> per folder, so the pane needs no toggle JS and no collapse state.
export function renderFileTreeNode(node: FileTreeNode, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement, coverage?: CoverageByTarget): HTMLElement {
    if (node.kind === FOLDER_NODE_KIND) {
        // `open: ""` because el's attrs are string-valued and a present `open` attribute expands a <details>.
        const kids = el("div", { class: "file-folder-kids" },
            node.children.map((child) => renderFileTreeNode(child, callbacks, selectionRoot, coverage)));
        const summary = el("summary", { class: FOLDER_NAME_CLASS, text: node.name });
        attachFolderClick(summary, node, callbacks, selectionRoot);
        return el("details", { class: "file-folder", open: "" }, [summary, kids]);
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
    const toggle = el("span", { class: "file-folder-toggle" });
    summary.prepend(toggle);
    folderTargetsBySummary.set(summary, listDescendantTargets(node));
    summary.addEventListener("click", (event) => {
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
        onFolderClick(listSelectedFolderTargets(selectionRoot));
    });
}

// De-duplicated because a selected parent and child folder overlap; only folder rows count here.
function listSelectedFolderTargets(selectionRoot: HTMLElement): string[] {
    const union = new Set<string>();
    for (const summary of selectionRoot.querySelectorAll(`.${FOLDER_NAME_CLASS}.${SELECTED_CLASS}`)) {
        for (const target of folderTargetsBySummary.get(summary as HTMLElement) ?? []) {
            union.add(target);
        }
    }
    return [...union];
}

// Recurses on `entry` rather than `kind`, since `entry` is what the leaf renderer requires.
function listDescendantTargets(node: FileTreeNode): string[] {
    if (node.entry !== undefined) {
        return [node.entry.target];
    }
    return node.children.flatMap(listDescendantTargets);
}

// Basename only, with the full path in the tooltip: the full path was truncated to uselessness.
function renderFileTreeLeaf(node: FileTreeNode, entry: FileSidebarEntry, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement, coverage?: CoverageByTarget): HTMLElement {
    const item = el("div", {
        class: entry.isDeleted ? "file-item deleted" : "file-item",
        text: node.name,
        title: entry.isDeleted ? `${entry.target} (deleted)` : entry.target,
    }, []);
    const segments = coverage?.get(entry.target);
    if (segments === undefined) {
        item.append(el("span", { class: "revcount", text: `(${entry.revisionCount})` }));
    } else {
        appendCoverageStrip(item, entry.target, segments);
    }
    if (entry.originalPath !== undefined) {
        item.append(el("span", {
            class: "rename-badge",
            // The label is pre-disambiguated; the basename fallback keeps unstamped entries working.
            text: `← ${entry.renameBadgeLabel ?? basenameOf(entry.originalPath)}`,
            title: `renamed from ${entry.originalPath}`,
        }));
    }
    item.addEventListener("click", () => {
        clearFileSelectionIn(selectionRoot);
        item.classList.add(SELECTED_CLASS);
        callbacks.onFileClick(entry.target);
    });
    return item;
}

function basenameOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

// Coverage strip + reason popover moved to views/sidebar-coverage.ts for the 250-line cap.
