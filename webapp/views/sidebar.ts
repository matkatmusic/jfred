// Fork-style project sidebar (item 66, plan phase 6): the "Sessions" and "Files" panes rendered
// into the static #drawer. The view-models come from webapp/views/timeline.ts
// (buildSessionsSidebarViewModel / buildFilesSidebarViewModel + buildFileTree) — this module only
// renders them and routes clicks back to the timeline through the callbacks.
// Item 77: the Files pane is a nested tree of <details>/basenames, not a flat list of full paths.

import { el } from "../app-dom.ts";
import type { CoverageSegment } from "./reconstruction-coverage.ts";
import { appendCoverageStrip } from "./sidebar-coverage.ts";

// task 119: the segments of each partially-recovered file's coverage strip, keyed by target.
// Built by reconstruction-render.ts's buildCoverageSegmentsByTarget — files with full coverage
// are absent (their rows keep the plain revision count).
type CoverageByTarget = Map<string, CoverageSegment[]>;

// One Sessions-pane entry (buildSessionsSidebarViewModel's shape).
type SessionSidebarEntry = {
    sessionId: string;
    shortLabel: string;
    jsonlFileName: string | undefined;
    rowCount: number;
    firstNodeIndex: number;
};

// One Files-pane entry (buildFilesSidebarViewModel's shape).
type FileSidebarEntry = {
    target: string;
    revisionCount: number;
    // True only when the file's LAST revision is a delete (item 77) — the leaf renders struck-through.
    isDeleted: boolean;
    // The path a renamed file was born at (item 77); undefined when it was never renamed.
    originalPath: string | undefined;
    // The badge's disambiguated inline text (task 91), computed by timeline-file-tree.ts's
    // applyRenameBadgeLabels; undefined when the file was never renamed.
    renameBadgeLabel: string | undefined;
};

// One Files-pane tree node (buildFileTree's shape). Mirrored, not imported: timeline.ts imports this
// module, so importing back would be a cycle — the same reason the entry types above are mirrored.
type FileTreeNode = {
    kind: string;
    name: string;
    children: FileTreeNode[];
    entry: FileSidebarEntry | undefined;
};

const FOLDER_NODE_KIND = "folder";

// The class marking the row a tree's current selection sits on. Shared by the leaf renderer, the
// folder renderer (task 253) and clearFileSelectionIn's query, so it is named once.
const SELECTED_CLASS = "selected";

// What a file tree needs from its owner. The Files sidebar and the details pane's "Files touched"
// tree (item 84) render the SAME tree with different click meanings, so this is the narrower half
// of ForkSidebarCallbacks.
export type FileTreeCallbacks = {
    onFileClick: (target: string) => void;
    // task 253: a folder click hands over the full paths of every LEAF at or below it, rather than
    // the folder's own path — buildFileTree strips the common directory prefix and a folder node
    // carries no path at all, so its descendants' targets are the only full paths the tree holds.
    // An empty list means the selection was cleared by re-clicking the selected folder.
    // Optional: only the Layer 1 File Nav filters by folder; the Files sidebar (views/timeline.ts)
    // and the details pane (views/details.ts) pass nothing and their folders stay inert.
    onFolderClick?: (targets: string[]) => void;
};

type ForkSidebarCallbacks = FileTreeCallbacks & {
    onSessionClick: (firstNodeIndex: number) => void;
};

// Un-mark the active row within ONE tree's container. There are now two trees on screen —
// #drawer's Files pane and #details-left's "Files touched" (item 84) — and a click in one must not
// clear the other's selection, so the root is explicit rather than hardcoded to #drawer.
// The selector is the class alone, not `.file-item.selected`: since task 253 a FOLDER row can hold
// the selection too, and one folder filter and one selected file must not sit marked at once. The
// two older callers are unaffected — their trees mark nothing but file rows.
export function clearFileSelectionIn(root: HTMLElement): void {
    for (const item of root.querySelectorAll(`.${SELECTED_CLASS}`)) {
        item.classList.remove(SELECTED_CLASS);
    }
}

// One Sessions-pane row appended to the drawer: `<short8>….jsonl` + `<short8> · N rows` meta,
// click flash-scrolls the session's first timeline row.
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

// Rebuild the drawer: a "Sessions" pane (`<short8>….jsonl` + `<short8> · N rows` meta, click
// flash-scrolls the session's first timeline row) and a "Files" pane (path + revision count,
// click enters the details pane's File Revisions mode and marks the item selected).
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

// A folder renders as a native <details open> (item 77: every folder starts expanded, so the pane
// needs no toggle JS and no collapse state); a file renders as the same .file-item the flat list
// used, so selection and clearFileSelectionIn keep working unchanged.
// Exported for item 84: the details pane's "Files touched" column renders this SAME tree over the
// selected node's own changed paths, rather than a second list of ellipsis-truncated full paths.
// `selectionRoot` is the container this tree lives in — a leaf click clears the selection within
// it and no further.
// `coverage` is optional: only the Files sidebar shows coverage strips (task 119) — the details
// pane's "Files touched" tree passes nothing and renders plain rows.
export function renderFileTreeNode(node: FileTreeNode, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement, coverage?: CoverageByTarget): HTMLElement {
    if (node.kind === FOLDER_NODE_KIND) {
        // open: "" — el's attrs are Record<string, string | EventListener> (webapp/app.ts:31), so a
        // boolean will not typecheck; el forwards unknown keys to setAttribute, and a present `open`
        // attribute is what expands a <details>.
        // task 123: one wrapper per folder — the CSS indents it one step and draws the
        // vertical guide line on its left border.
        const kids = el("div", { class: "file-folder-kids" },
            node.children.map((child) => renderFileTreeNode(child, callbacks, selectionRoot, coverage)));
        const summary = el("summary", { class: "file-folder-name", text: node.name });
        attachFolderClick(summary, node, callbacks, selectionRoot);
        return el("details", { class: "file-folder", open: "" }, [summary, kids]);
    }
    return renderFileTreeLeaf(node, node.entry!, callbacks, selectionRoot, coverage);
}

// task 253: make a folder row select (and re-select off) the files below it. Nothing is attached
// when the owner declared no folder behaviour, so the two older trees keep inert folders.
//
// NO preventDefault and NO stopPropagation: opening and closing the <details> is this very click's
// DEFAULT ACTION on a <summary>, and cancelling it would trade the pane's expand/collapse for the
// filter. The "is it already selected" state is read back off the DOM rather than held in a module
// variable — the row's own class already is that state, and clearFileSelectionIn wipes it in step
// with every other selection in the tree.
function attachFolderClick(summary: HTMLElement, node: FileTreeNode, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement): void {
    const onFolderClick = callbacks.onFolderClick;
    if (onFolderClick === undefined) {
        return;
    }
    // The expand/collapse triangle becomes a REAL element here, so a click on it is distinguishable
    // by `event.target` — as the row's ::before decoration it was a pseudo-element, which is not an
    // event target, and reaching for it to see what was inside a folder also filtered the timeline
    // to it. Added only for an owner that filters by folder; the other two trees keep the CSS-only
    // marker and need no such distinction.
    const toggle = el("span", { class: "file-folder-toggle" });
    summary.prepend(toggle);
    summary.addEventListener("click", (event) => {
        // The triangle opens and closes, and does nothing else. Returning early rather than
        // cancelling the event: opening the <details> is this click's default action either way.
        if (event.target === toggle) {
            return;
        }
        const wasSelected = summary.classList.contains(SELECTED_CLASS);
        clearFileSelectionIn(selectionRoot);
        summary.classList.toggle(SELECTED_CLASS, !wasSelected);
        onFolderClick(wasSelected ? [] : listDescendantTargets(node));
    });
}

// Every file leaf at or below `node`, as full paths. Recurses on the presence of `entry` rather than
// on `kind`: `entry` is what the leaf renderer actually requires (`node.entry!` below), so the two
// cannot fall out of step.
function listDescendantTargets(node: FileTreeNode): string[] {
    if (node.entry !== undefined) {
        return [node.entry.target];
    }
    return node.children.flatMap(listDescendantTargets);
}

// One file row: the basename only (item 77 — the full path was truncated to uselessness), with the
// full path in the tooltip, its revision count, and a badge naming where a rename moved it from.
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
            // task 91: the label is pre-disambiguated (shortest distinguishing suffix on
            // collision); the basename fallback keeps an unstamped entry rendering as before.
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

// Coverage strip + reason popover (task 119): moved to views/sidebar-coverage.ts (task 253 — the
// 250-line cap; split, never condense).
