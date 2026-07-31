// Task 252: the Layer 1 File Nav — every identified file, in a pane left of the ruler gutter.
//
// Reuses buildFileTree + renderFileTreeNode; only the entry list is built here, from /api/layer1-view.
//
// Its own module rather than more of webapp/layer1-page.ts, which is at the repo's 250-line cap.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { getCollapsedFoldersForProject, saveFolderCollapseState } from "./layer1-settings.ts";
import { jumpToBubbleAtPath } from "./layer1-find-file.ts";
import { renderFileTreeNode, type FolderCollapseState } from "./views/sidebar.ts";
import { buildFileTree } from "./views/timeline-file-tree.ts";

// The /api/layer1-view slice the nav reads; declared structurally since importing layer1-page.ts back would cycle.
export interface FileNavView {
    pairs: { path: string; commits: unknown[] }[];
    gitOrphans: { path: string }[];
    diskOrphans: { path: string }[];
}

// One nav row in the tree's shape; Layer 1 knows nothing about renames, so those fields stay undefined.
function describeNavEntry(path: string, revisionCount: number, isDeleted: boolean) {
    return { target: path, revisionCount, isDeleted, originalPath: undefined, renameBadgeLabel: undefined };
}

// Every identified file as a tree entry; the three sources are disjoint, so concatenation not merge.
export function listFileNavEntries(view: FileNavView) {
    return [
        // Paired: on disk AND in the repo; its commit count is the only count Layer 1 has.
        ...view.pairs.map((pair) => describeNavEntry(pair.path, pair.commits.length, false)),
        // In the repo tree but absent from disk: deleted rows, with no commit count on the wire.
        ...view.gitOrphans.map((orphan) => describeNavEntry(orphan.path, 0, true)),
        // On disk but absent from the repo: present, not deleted, no repo history to count.
        ...view.diskOrphans.map((orphan) => describeNavEntry(orphan.path, 0, false)),
    ];
}

// Task 325: leaf click selects the on-disk node; the synthetic click rides the stage's delegated drawer handler.
// ponytail: polls because a filter repaint rebuilds the stage async; 2 s ceiling, then the orphan report stands.
export function openDiskNodeForPath(path: string, attempt: number = 0): void {
    const bubble = jumpToBubbleAtPath(path);
    if (bubble !== undefined) {
        bubble.querySelector<HTMLElement>(".node.n-disk")?.click();
        return;
    }
    if (attempt < 20) {
        setTimeout(() => openDiskNodeForPath(path, attempt + 1), 100);
    }
}

// Collapsed folders for the open project; reseeded per project load, mutated in place by toggles.
let collapsedFolderPaths = new Set<string>();

// Exported so a direct-render test can reset state an earlier test in the same file left behind.
export function resetFileNavCollapseState(initial: Iterable<string> = []): void {
    collapsedFolderPaths = new Set(initial);
}

function persistFolderToggle(folderPath: string, isOpen: boolean): void {
    if (isOpen) {
        collapsedFolderPaths.delete(folderPath);
    } else {
        collapsedFolderPaths.add(folderPath);
    }
    saveFolderCollapseState([...collapsedFolderPaths]);
}

// `container` is also the selection root; `onFolderSelect` reports folder selections; `query` filters entries pre-tree.
export function renderFileNavInto(container: HTMLElement, view: FileNavView, onFolderSelect: (targets: string[]) => void, query: string = ""): void {
    const needle = query.trim().toLowerCase();
    const matched = listFileNavEntries(view).filter((entry) => entry.target.toLowerCase().includes(needle));
    const collapse: FolderCollapseState = { collapsedPaths: collapsedFolderPaths, onToggle: persistFolderToggle };
    container.replaceChildren(
        ...buildFileTree(matched).map((node) =>
            renderFileTreeNode(node, { onFileClick: openDiskNodeForPath, onFolderClick: onFolderSelect }, container, undefined, collapse)),
    );
}

// The page-facing wrapper; handlers wired by assignment so a re-render never stacks stale listeners.
export function renderLayer1FileNav(view: FileNavView, onFolderSelect: (targets: string[]) => void): void {
    resetFileNavCollapseState(getCollapsedFoldersForProject(getInputById("dir").value.trim()));
    const tree = getRequiredElementById("filenav-tree");
    const box = getRequiredElementById("filenav-search") as HTMLInputElement;
    box.oninput = () => renderFileNavInto(tree, view, onFolderSelect, box.value);
    getRequiredElementById("filenav-search-clear").onclick = () => {
        box.value = "";
        renderFileNavInto(tree, view, onFolderSelect, box.value);
    };
    // The box's text survives a reload, so the initial render reads it rather than assuming "".
    renderFileNavInto(tree, view, onFolderSelect, box.value);
}
