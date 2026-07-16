// Fork-style project sidebar (item 66, plan phase 6): the "Sessions" and "Files" panes rendered
// into the static #drawer. The view-models come from webapp/views/timeline.ts
// (buildSessionsSidebarViewModel / buildFilesSidebarViewModel + buildFileTree) — this module only
// renders them and routes clicks back to the timeline through the callbacks.
// Item 77: the Files pane is a nested tree of <details>/basenames, not a flat list of full paths.

import { el } from "../app-dom.ts";

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

// What a file tree needs from its owner. The Files sidebar and the details pane's "Files touched"
// tree (item 84) render the SAME tree with different click meanings, so this is the narrower half
// of ForkSidebarCallbacks.
export type FileTreeCallbacks = {
    onFileClick: (target: string) => void;
};

type ForkSidebarCallbacks = FileTreeCallbacks & {
    onSessionClick: (firstNodeIndex: number) => void;
};

// Un-mark the active file within ONE tree's container. There are now two trees on screen —
// #drawer's Files pane and #details-left's "Files touched" (item 84) — and a click in one must not
// clear the other's selection, so the root is explicit rather than hardcoded to #drawer.
export function clearFileSelectionIn(root: HTMLElement): void {
    for (const item of root.querySelectorAll(".file-item.selected")) {
        item.classList.remove("selected");
    }
}

// Rebuild the drawer: a "Sessions" pane (`<short8>….jsonl` + `<short8> · N rows` meta, click
// flash-scrolls the session's first timeline row) and a "Files" pane (path + revision count,
// click enters the details pane's File Revisions mode and marks the item selected).
export function renderForkSidebar(drawer: HTMLElement, sessions: SessionSidebarEntry[], files: FileTreeNode[], callbacks: ForkSidebarCallbacks): void {
    drawer.replaceChildren();
    drawer.append(el("div", { class: "pane-title", text: "Sessions" }));
    for (const session of sessions) {
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
    drawer.append(el("div", { class: "pane-title", text: "Files" }));
    for (const node of files) {
        drawer.append(renderFileTreeNode(node, callbacks, drawer));
    }
}

// A folder renders as a native <details open> (item 77: every folder starts expanded, so the pane
// needs no toggle JS and no collapse state); a file renders as the same .file-item the flat list
// used, so selection and clearFileSelectionIn keep working unchanged.
// Exported for item 84: the details pane's "Files touched" column renders this SAME tree over the
// selected node's own changed paths, rather than a second list of ellipsis-truncated full paths.
// `selectionRoot` is the container this tree lives in — a leaf click clears the selection within
// it and no further.
export function renderFileTreeNode(node: FileTreeNode, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement): HTMLElement {
    if (node.kind === FOLDER_NODE_KIND) {
        // open: "" — el's attrs are Record<string, string | EventListener> (webapp/app.ts:31), so a
        // boolean will not typecheck; el forwards unknown keys to setAttribute, and a present `open`
        // attribute is what expands a <details>.
        return el("details", { class: "file-folder", open: "" }, [
            el("summary", { class: "file-folder-name", text: node.name }),
            ...node.children.map((child) => renderFileTreeNode(child, callbacks, selectionRoot)),
        ]);
    }
    return renderFileTreeLeaf(node, node.entry!, callbacks, selectionRoot);
}

// One file row: the basename only (item 77 — the full path was truncated to uselessness), with the
// full path in the tooltip, its revision count, and a badge naming where a rename moved it from.
function renderFileTreeLeaf(node: FileTreeNode, entry: FileSidebarEntry, callbacks: FileTreeCallbacks, selectionRoot: HTMLElement): HTMLElement {
    const item = el("div", {
        class: entry.isDeleted ? "file-item deleted" : "file-item",
        text: node.name,
        title: entry.isDeleted ? `${entry.target} (deleted)` : entry.target,
    }, []);
    item.append(el("span", { class: "revcount", text: `(${entry.revisionCount})` }));
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
        item.classList.add("selected");
        callbacks.onFileClick(entry.target);
    });
    return item;
}

function basenameOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

