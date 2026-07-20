// Details pane (item 66): the fork layout's bottom pane. Task 92 split it four ways: the
// DOM-free view-model half lives in details-model.ts, the right-column text/content/diff
// renders in details-diff.ts, the File-Revisions mode in details-revision-view.ts. This
// module keeps the left-pane file list and the message + commit mode renderers, which touch
// the static #details-* skeleton that index.html declares.

import { el } from "../app-dom.ts";
import { revealDetailsPane } from "../inspector.ts";
import { deriveCommitChangedFiles } from "./timeline-commit-files.ts";
import {
    applyRenameBadgeLabels,
    buildFileTree,
    buildFilesSidebarViewModel,
    type FileSidebarEntry,
} from "./timeline-file-tree.ts";
import {
    type FileChange,
    type TimelineNode,
    type WireTimelineDocument,
} from "./timeline-types.ts";
import { type DetailsContext, computeDetailsHeaderText, fullContentsIsOn } from "./details-model.ts";
import {
    clearRightPaneBody,
    fetchRevisionDiffBlocks,
    hideDiffModeToggle,
    setDetailsHeader,
    setRightPaneLabel,
    showRevisionDiffInDetails,
} from "./details-diff.ts";
import { renderFileTreeNode, type FileTreeCallbacks } from "./sidebar.ts";

// This node's touched files as file-tree entries — ONLY the paths it changed, never the whole
// project. Revision count / deleted / renamed-from come from the document's own histories via
// buildFilesSidebarViewModel (the same source the Files sidebar reads, so the two trees agree
// about a file); a changed path with no surviving history still gets a leaf, from the change
// itself. Deduped by path: a turn that edits one file twice shows ONE leaf, carrying its LAST
// change — the file's end state for this node.
function buildTouchedFileEntries(changes: FileChange[], wireDocument: WireTimelineDocument): FileSidebarEntry[] {
    const sidebarEntriesByTarget = new Map(
        buildFilesSidebarViewModel(wireDocument).map((entry) => [entry.target, entry]),
    );
    const entriesByTarget = new Map<string, FileSidebarEntry>();
    for (const change of changes) {
        // Entries display the ENTRY-TIME name (task 127): the visible target is the change's
        // displayPath; lookups into the sidebar view-model stay keyed by the final path.
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
    // Relabel COPIES, pane-locally (task 91): this pane shows only the node's own files, so its
    // badges disambiguate among those; the copies are mandatory because `known` entries are the
    // SAME objects the Files sidebar holds — relabeling them in place would rewrite the
    // sidebar's badges as a side effect of opening a node.
    const entries = [...entriesByTarget.values()].map((entry) => ({ ...entry }));
    applyRenameBadgeLabels(entries);
    return entries;
}

// The left pane's clickable file list (message + commit modes): clicking a file marks it
// selected and swaps the right pane to its revision diff.
// (item 84 follow-up) The flat `.dfile` list of ellipsis-truncated FULL paths is replaced by the
// Files sidebar's own tree component (item 77's renderFileTreeNode): basenames, folder grouping,
// rename badges, struck-through deletes. Returned in DOM order, so renderDetailsCommitMode's
// `items[0]!.click()` still opens the first file the user actually sees. The tree covers ONLY the
// node's own changed paths — never the whole project.
// old:
// function appendFileList(left: HTMLElement, changes: FileChange[], context: DetailsContext): HTMLElement[] {
//     return changes.map((change) => {
//         const item = el("div", { class: "dfile", text: change.path });
//         // Re-callable so the full-contents toggle can re-fetch this file's diff at the
//         // current stored context width (item 75).
//         const showThisFileDiff = async () => {
//             const blocks = await fetchRevisionDiffBlocks(context.project, change.path, fullContentsIsOn());
//             await showRevisionDiffInDetails(change, blocks, context.document.filesTouched, () => void showThisFileDiff());
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
// Extracted onFileClick body: resolve the clicked path to its FileChange and show its diff.
function showClickedFileDiff(
    target: string,
    changeByPath: Map<string, FileChange>,
    showFileDiff: (change: FileChange) => Promise<void>,
): void {
    const change = changeByPath.get(target);
    if (change === undefined) {
        return;
    }
    void showFileDiff(change);
}

function appendFileList(left: HTMLElement, changes: FileChange[], context: DetailsContext): HTMLElement[] {
    // A leaf click knows only its path; the diff needs the FileChange (its changeId resolves the
    // revision, its eventKind picks the rename/no-hunk fallback text). Last change per path wins,
    // matching buildTouchedFileEntries' dedup. Keyed by displayPath (task 127) — the tree's
    // entries carry the entry-time name, and onFileClick echoes that back.
    const changeByPath = new Map(changes.map((change) => [change.displayPath, change]));
    // Re-callable so the full-contents toggle can re-fetch this file's diff at the current stored
    // context width (item 75).
    const showFileDiff = async (change: FileChange) => {
        const blocks = await fetchRevisionDiffBlocks(context.project, change.path, fullContentsIsOn());
        await showRevisionDiffInDetails(change, blocks, context.document.filesTouched, () => void showFileDiff(change));
    };
    const callbacks: FileTreeCallbacks = {
        onFileClick: (target: string) => {
            showClickedFileDiff(target, changeByPath, showFileDiff);
        },
    };
    for (const node of buildFileTree(buildTouchedFileEntries(changes, context.document))) {
        left.append(renderFileTreeNode(node, callbacks, left));
    }
    return [...left.querySelectorAll(".file-item")] as HTMLElement[];
}

// ── the message + commit modes ──────────────────────────────────────────────────────────────

// Message mode: header + "Files touched" on the left, the transcript inspector (the node's own
// line) on the right by default; clicking a file swaps the right pane to its revision diff.
export function renderDetailsMessageMode(node: TimelineNode, nodeIndex: number, context: DetailsContext): void {
    revealDetailsPane();
    setDetailsHeader(computeDetailsHeaderText(node, { index: nodeIndex, total: context.nodes.length }));
    const left = document.getElementById("details-left")!;
    left.replaceChildren(el("div", { class: "pane-title", text: "Files touched" }));
    const changes = node.fileChanges ?? [];
    if (changes.length === 0) {
        left.append(el("div", { class: "dempty", text: "No files touched" }));
    } else {
        appendFileList(left, changes, context);
    }
    context.openNodeInspector(nodeIndex);
}

// Commit mode: header + "Changed files" (everything touched since the previous commit) on the
// left, the FIRST file's diff auto-shown on the right (mockup behavior).
export function renderDetailsCommitMode(node: TimelineNode, nodeIndex: number, context: DetailsContext): void {
    revealDetailsPane();
    setDetailsHeader(computeDetailsHeaderText(node, { index: nodeIndex, total: context.nodes.length }));
    const left = document.getElementById("details-left")!;
    left.replaceChildren(el("div", { class: "pane-title", text: "Changed files" }));
    const changes = deriveCommitChangedFiles(context.nodes, nodeIndex);
    if (changes.length === 0) {
        left.append(el("div", { class: "dempty", text: "No files changed" }));
        setRightPaneLabel("—");
        hideDiffModeToggle();
        clearRightPaneBody();
        return;
    }
    const items = appendFileList(left, changes, context);
    items[0]!.click();
}
