// Files-pane view-model (split from timeline.ts, task 92): the sidebar's flat entries and the
// nested, prefix-stripped, chain-collapsed file tree (items 66/77, task 90).
import { applyRenameBadgeLabels, findScriptRenameSource } from "./timeline-file-badges.js";
import { DELETE_EVENT_KIND, RENAME_EVENT_KIND, } from "./timeline-types.js";
// The Files sidebar's entries (item 66): every surviving touched file with its revision count,
// plus its delete/rename facts (item 77) and its disambiguated rename badge (task 91).
export function buildFilesSidebarViewModel(document) {
    const entries = document.filesTouched.map((history) => ({
        target: history.target,
        revisionCount: history.revisions.length,
        isDeleted: findLastRevisionKind(history) === DELETE_EVENT_KIND,
        originalPath: findOriginalPath(history) ?? findScriptRenameSource(document, history.target),
        renameBadgeLabel: undefined,
    }));
    applyRenameBadgeLabels(entries);
    return entries;
}
// Badge machinery (RenameBadge, applyRenameBadgeLabels, findScriptRenameSource): moved to
// timeline-file-badges.ts (task 145 — the line cap; split, never condense).
// The kind of the revision a file ends life at; undefined for an empty history.
function findLastRevisionKind(history) {
    return history.revisions[history.revisions.length - 1]?.kind;
}
// The path a renamed file started at: the FIRST rename revision's `from`. A chained rename
// (a->b->c) leaves revisions from=a,to=b then from=b,to=c, so the earliest `from` is the origin.
function findOriginalPath(history) {
    return history.revisions.find((revision) => revision.kind === RENAME_EVENT_KIND)?.rename?.from;
}
// A Files-pane tree node (item 77): a folder with children, or a file leaf carrying its entry.
// Mirrored (not imported) by webapp/views/sidebar.ts — this module's family imports sidebar.ts,
// so importing back would be a cycle; that file's other view-model types are mirrored the same way.
export const FOLDER_NODE_KIND = "folder";
export const FILE_NODE_KIND = "file";
// The directory segments every target shares, as a path (item 77). Real targets are absolute and
// deep (/private/var/folders/…/T/run-scenario.xxxx/alpha.py), so the tree strips this prefix —
// otherwise the pane is a chain of single-child folders before the first real file, which is the
// truncation item 77 is about. Segment-wise on purpose: a character-wise prefix of /foo/bar and
// /foo/barn wrongly yields /foo/bar.
export function findCommonDirectoryPrefix(targets) {
    const directories = targets.map(splitDirectorySegments);
    if (directories.length === 0) {
        return "";
    }
    return directories.reduce(intersectLeadingSegments).join("/");
}
// A target's directory, as segments — never its basename, so a lone file keeps its own name.
function splitDirectorySegments(target) {
    return target.split("/").slice(0, -1);
}
// The leading segments two paths agree on.
function intersectLeadingSegments(left, right) {
    const shared = [];
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        if (left[index] !== right[index]) {
            break;
        }
        shared.push(left[index]);
    }
    return shared;
}
// Shape the flat Files entries into a nested tree, rooted below the directory prefix every target
// shares (item 77). Folders sort before files; each group sorts alphabetically.
export function buildFileTree(files) {
    const prefix = findCommonDirectoryPrefix(files.map((file) => file.target));
    const root = makeFolderNode("");
    for (const file of files) {
        insertFileIntoTree(root, file, prefix);
    }
    sortTreeNodes(root);
    collapseSingleChildFolderChains(root.children);
    return root.children;
}
function makeFolderNode(name) {
    return { kind: FOLDER_NODE_KIND, name, children: [], entry: undefined };
}
// Walk (creating as needed) the folder chain below the stripped prefix, then hang the file leaf.
function insertFileIntoTree(root, file, prefix) {
    const segments = stripPrefixSegments(file.target, prefix);
    const fileName = segments[segments.length - 1];
    let folder = root;
    for (const directory of segments.slice(0, -1)) {
        folder = findOrAddFolder(folder, directory);
    }
    folder.children.push({ kind: FILE_NODE_KIND, name: fileName, children: [], entry: file });
}
// A target's segments below the shared prefix. Splitting the REMAINDER (not the whole target) is
// what removes the deep absolute root; the filter drops the remainder's empty leading segment.
function stripPrefixSegments(target, prefix) {
    return target.slice(prefix.length).split("/").filter((segment) => segment !== "");
}
function findOrAddFolder(parent, name) {
    const existing = parent.children.find((child) => child.kind === FOLDER_NODE_KIND && child.name === name);
    if (existing !== undefined) {
        return existing;
    }
    const folder = makeFolderNode(name);
    parent.children.push(folder);
    return folder;
}
// Folders before files, then alphabetical — applied at every depth.
function sortTreeNodes(folder) {
    folder.children.sort(compareTreeNodes);
    for (const child of folder.children) {
        sortTreeNodes(child);
    }
}
function compareTreeNodes(left, right) {
    if (left.kind !== right.kind) {
        return left.kind === FOLDER_NODE_KIND ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
}
// Merge each folder holding exactly one folder child into a combined `a/b/c` node (task 90):
// in multi-root projects the shared prefix is shallow, so real single-child chains survive
// below it and cost one click per level. Only folder->folder merges — a lone FILE child keeps
// its own row. Runs after sorting on purpose: sibling order stays keyed to the original first
// segment. The root header itself never collapses (root-level collapsing was declined).
function collapseSingleChildFolderChains(nodes) {
    for (const node of nodes) {
        while (nodeHoldsExactlyOneFolderChild(node)) {
            const onlyChild = node.children[0];
            node.name = `${node.name}/${onlyChild.name}`;
            node.children = onlyChild.children;
        }
        collapseSingleChildFolderChains(node.children);
    }
}
// True when the node is a folder whose single child is itself a folder — the collapsible link.
function nodeHoldsExactlyOneFolderChild(node) {
    if (node.kind !== FOLDER_NODE_KIND || node.children.length !== 1) {
        return false;
    }
    return node.children[0].kind === FOLDER_NODE_KIND;
}
