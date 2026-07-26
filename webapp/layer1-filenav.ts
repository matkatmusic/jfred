// Task 252: the Layer 1 page's File Nav — every identified file, including repo files with no
// current on-disk presence, in a pane left of the sticky ruler gutter.
//
// It REUSES the webapp's existing tree (user-confirmed 2026-07-25): buildFileTree does the
// common-prefix stripping, folders-before-files sort and single-child chain collapse, and
// renderFileTreeNode draws the native <details>/leaf rows. What is written HERE is only the entry
// list those two consume: Layer 1 has no WireTimelineDocument, so buildFilesSidebarViewModel — which
// takes one — cannot be the source, and the entries are constructed from the /api/layer1-view
// payload instead.
//
// Its own module rather than more of webapp/layer1-page.ts, which is at the repo's 250-line cap.

import { getRequiredElementById } from "./app-dom.ts";
import { jumpToBubbleAtPath } from "./layer1-find-file.ts";
import { renderFileTreeNode } from "./views/sidebar.ts";
import { buildFileTree } from "./views/timeline-file-tree.ts";

// The slice of /api/layer1-view the nav reads. `commits` is only ever COUNTED, so its element type
// is deliberately unspecified. Declared structurally rather than imported from layer1-page.ts:
// that module imports THIS one, so importing its WireLayer1View back would be a cycle (the same
// reason webapp/views/sidebar.ts mirrors timeline-file-tree.ts's types).
export interface FileNavView {
    pairs: { path: string; commits: unknown[] }[];
    gitOrphans: { path: string }[];
    diskOrphans: { path: string }[];
}

// One nav row in the shape buildFileTree and renderFileTreeNode consume. `originalPath` and
// `renameBadgeLabel` are always undefined: Layer 1 compares a working tree against a repo tree and
// knows nothing about renames. One factory so the three call sites below cannot drift apart.
function describeNavEntry(path: string, revisionCount: number, isDeleted: boolean) {
    return { target: path, revisionCount, isDeleted, originalPath: undefined, renameBadgeLabel: undefined };
}

// Every identified file as a tree entry. The three sources are disjoint by construction
// (src/layer1_pairing.ts), so this is a concatenation and not a merge.
export function listFileNavEntries(view: FileNavView) {
    return [
        // Paired: on disk AND in the repo. Its commit count is the only count Layer 1 has.
        ...view.pairs.map((pair) => describeNavEntry(pair.path, pair.commits.length, false)),
        // In the repo tree, absent from disk — the deleted rows, and the reason this pane cannot be
        // driven off the disk walk alone. The wire carries no commit count for an orphan, so 0
        // rather than a guess.
        ...view.gitOrphans.map((orphan) => describeNavEntry(orphan.path, 0, true)),
        // On disk, absent from the repo: present, so not deleted, and with no repo history to count.
        ...view.diskOrphans.map((orphan) => describeNavEntry(orphan.path, 0, false)),
    ];
}

// Draw the tree into `container`, which is also the selection root — a leaf click clears the
// selection within THIS tree and no further, which is why renderFileTreeNode takes that parameter.
//
// The click uses jumpToBubbleAtPath, the EXACT-path jump (task 278) — never the typed box's
// jumpToNamedBubble. A leaf knows the exact path it represents, so a substring match and a cycle
// counter are both wrong here: clicking `.gitignore` twice must land the same bubble twice, and the
// root `.gitignore` path is a substring of every nested one, so no substring rule could pick it.
// An ORPHAN has no bubble of its own — it lives in a bucket — and jumpToBubbleAtPath reports that
// into the crumb.
//
// `onFolderSelect` is task 253's timeline filter: a folder click hands back the full paths of every
// file at or below it, or an empty list when re-clicking the selected folder cleared it. The nav
// only REPORTS the selection — it neither filters nor redraws, which is what lets the page leave
// this pane standing (still listing every file, still holding the folder's own selected/expanded
// state) while the stage beside it is redrawn from the filtered set.
export function renderFileNavInto(container: HTMLElement, view: FileNavView, onFolderSelect: (targets: string[]) => void): void {
    container.replaceChildren(
        ...buildFileTree(listFileNavEntries(view)).map((node) =>
            renderFileTreeNode(node, { onFileClick: jumpToBubbleAtPath, onFolderClick: onFolderSelect }, container)),
    );
}

// The page-facing wrapper: the nav's one host element on layer1.html.
export function renderLayer1FileNav(view: FileNavView, onFolderSelect: (targets: string[]) => void): void {
    renderFileNavInto(getRequiredElementById("filenav-tree"), view, onFolderSelect);
}
