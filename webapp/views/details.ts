// Details pane (item 66): left-pane file list plus message/commit renderers; touches the static #details-* skeleton in index.html.

import { el } from "../app-dom.ts";
import { revealDetailsPane } from "../inspector.ts";
import { deriveCommitChangedFiles } from "./timeline-commit-files.ts";
import { applyRenameBadgeLabels } from "./timeline-file-badges.ts";
import {
    buildFileTree,
    buildFilesSidebarViewModel,
    type FileSidebarEntry,
} from "./timeline-file-tree.ts";
import {
    type FileChange,
    type TimelineNode,
    type WireTimelineDocument,
} from "./timeline-types.ts";
import { type DetailsContext, checkChangeIdIsGitBaseline, computeDetailsHeaderText, fullContentsIsOn } from "./details-model.ts";
import { showGitBaselineInDetails } from "./details-baseline.ts";
import {
    clearRightPaneBody,
    fetchRevisionDiffBlocks,
    hideDiffModeToggle,
    setDetailsHeader,
    setRightPaneLabel,
    showRevisionDiffInDetails,
} from "./details-diff.ts";
import { renderFileTreeNode, type FileTreeCallbacks } from "./sidebar.ts";

// Only this node's changed paths, deduped by path so a twice-edited file shows ONE leaf, mirroring buildFilesSidebarViewModel.
function buildTouchedFileEntries(changes: FileChange[], wireDocument: WireTimelineDocument): FileSidebarEntry[] {
    const sidebarEntriesByTarget = new Map(
        buildFilesSidebarViewModel(wireDocument).map((entry) => [entry.target, entry]),
    );
    const entriesByTarget = new Map<string, FileSidebarEntry>();
    for (const change of changes) {
        // Entries display the ENTRY-TIME name, but lookups stay keyed by the final path (task 127).
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
    // Copies are mandatory: `known` entries are the SAME objects the Files sidebar holds; relabeling corrupts its badges (task 91).
    const entries = [...entriesByTarget.values()].map((entry) => ({ ...entry }));
    applyRenameBadgeLabels(entries);
    return entries;
}

// Returned in DOM order, so renderDetailsCommitMode's `items[0]!.click()` opens the first file the user actually sees (item 84 follow-up).
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
    // Keyed by displayPath since the tree echoes that name back (task 127); last change per path wins, matching buildTouchedFileEntries.
    const changeByPath = new Map(changes.map((change) => [change.displayPath, change]));
    // Re-callable so the full-contents toggle can re-fetch this file's diff at the current stored context width (item 75).
    const showFileDiff = async (change: FileChange) => {
        // task 56 follow-up: a base-commit beacon's diff is empty — show the committed bytes.
        if (checkChangeIdIsGitBaseline(change.changeId)) {
            showGitBaselineInDetails(context.document, change.path, change.changeId!);
            return;
        }
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

// "Changed files" means everything touched since the PREVIOUS commit.
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
