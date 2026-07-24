// Fork-style project sidebar (item 66, plan phase 6): the "Sessions" and "Files" panes rendered
// into the static #drawer. The view-models come from webapp/views/timeline.ts
// (buildSessionsSidebarViewModel / buildFilesSidebarViewModel + buildFileTree) — this module only
// renders them and routes clicks back to the timeline through the callbacks.
// Item 77: the Files pane is a nested tree of <details>/basenames, not a flat list of full paths.
import { el } from "../app-dom.js";
const FOLDER_NODE_KIND = "folder";
// Un-mark the active file within ONE tree's container. There are now two trees on screen —
// #drawer's Files pane and #details-left's "Files touched" (item 84) — and a click in one must not
// clear the other's selection, so the root is explicit rather than hardcoded to #drawer.
export function clearFileSelectionIn(root) {
    for (const item of root.querySelectorAll(".file-item.selected")) {
        item.classList.remove("selected");
    }
}
// One Sessions-pane row appended to the drawer: `<short8>….jsonl` + `<short8> · N rows` meta,
// click flash-scrolls the session's first timeline row.
function appendSessionItem(drawer, session, callbacks) {
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
export function renderForkSidebar(drawer, sessions, files, callbacks, coverage) {
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
export function renderFileTreeNode(node, callbacks, selectionRoot, coverage) {
    if (node.kind === FOLDER_NODE_KIND) {
        // open: "" — el's attrs are Record<string, string | EventListener> (webapp/app.ts:31), so a
        // boolean will not typecheck; el forwards unknown keys to setAttribute, and a present `open`
        // attribute is what expands a <details>.
        // task 123: one wrapper per folder — the CSS indents it one step and draws the
        // vertical guide line on its left border.
        const kids = el("div", { class: "file-folder-kids" }, node.children.map((child) => renderFileTreeNode(child, callbacks, selectionRoot, coverage)));
        return el("details", { class: "file-folder", open: "" }, [
            el("summary", { class: "file-folder-name", text: node.name }),
            kids,
        ]);
    }
    return renderFileTreeLeaf(node, node.entry, callbacks, selectionRoot, coverage);
}
// One file row: the basename only (item 77 — the full path was truncated to uselessness), with the
// full path in the tooltip, its revision count, and a badge naming where a rename moved it from.
function renderFileTreeLeaf(node, entry, callbacks, selectionRoot, coverage) {
    const item = el("div", {
        class: entry.isDeleted ? "file-item deleted" : "file-item",
        text: node.name,
        title: entry.isDeleted ? `${entry.target} (deleted)` : entry.target,
    }, []);
    const segments = coverage?.get(entry.target);
    if (segments === undefined) {
        item.append(el("span", { class: "revcount", text: `(${entry.revisionCount})` }));
    }
    else {
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
        item.classList.add("selected");
        callbacks.onFileClick(entry.target);
    });
    return item;
}
function basenameOf(path) {
    return path.slice(path.lastIndexOf("/") + 1);
}
// ─── task 119: coverage strip + click-for-reason popover ───
// The one open coverage popover and the segment that opened it (clicking that segment again
// closes it). One document-level click closes it from anywhere, the toolbar popovers' pattern
// (app-header.ts) — in-popover and segment clicks stopPropagation to stay open.
let openCoveragePopover;
function hideCoveragePopover() {
    openCoveragePopover?.popover.remove();
    openCoveragePopover = undefined;
}
// Guarded like app.ts's bootstrap: the node test suite imports this module without a DOM.
if (typeof document !== "undefined") {
    document.addEventListener("click", hideCoveragePopover);
}
// The strip on a partially-recovered file's row: one segment per revision (red = unrecoverable,
// click for the reason popover) and "<recovered> / <total> revs" in place of the plain count.
function appendCoverageStrip(item, target, segments) {
    item.append(el("span", { class: "covbar" }, segments.map((segment) => buildCoverageSegmentElement(item, target, segment))));
    const recovered = segments.filter((segment) => segment.recovered).length;
    item.append(el("span", { class: "revcount", text: `${recovered} / ${segments.length} revs` }));
}
// One strip segment; a red (unrecovered) one toggles the reason popover under the row. The
// stopPropagation keeps the click from also selecting the file row (and from the document-level
// closer instantly hiding the popover it just opened).
function buildCoverageSegmentElement(item, target, segment) {
    const cell = el("span", { class: segment.recovered ? "" : "miss" });
    if (!segment.recovered) {
        cell.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleCoveragePopover(cell, item, target, segment);
        });
    }
    return cell;
}
// Show (or hide, when its own segment is re-clicked) the reason popover, inserted into the
// flow right under the segment's file row.
function toggleCoveragePopover(cell, item, target, segment) {
    const wasOpen = openCoveragePopover?.segment === cell;
    hideCoveragePopover();
    if (wasOpen) {
        return;
    }
    const popover = el("div", { class: "popover cov-popover" }, [
        el("div", { text: `${target} — rev ${segment.revisionIndex + 1} ✗ unrecoverable` }),
        el("div", { class: "muted", text: `reason: ${segment.reason ?? "unknown"}` }),
    ]);
    popover.addEventListener("click", (event) => event.stopPropagation());
    item.after(popover);
    openCoveragePopover = { segment: cell, popover };
}
