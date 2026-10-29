// Files-pane nested, prefix-stripped, chain-collapsed file tree (items 66/77, task 90); entries live in timeline-file-tree-sidebar.ts.

import type { FileSidebarEntry } from "./timeline-file-tree-sidebar.ts";

// Tree node kinds; sidebar.ts mirrors them instead of importing, to avoid a cycle.
export const FOLDER_NODE_KIND = "folder";
export const FILE_NODE_KIND = "file";

export type FileTreeNode = {
  kind: typeof FOLDER_NODE_KIND | typeof FILE_NODE_KIND;
  name: string;
  children: FileTreeNode[];
  // Set only on a file leaf.
  entry: FileSidebarEntry | undefined;
};

// The directory segments every target shares, as a path (item 77). Segment-wise: /foo/bar and /foo/barn share /foo.
export function findCommonDirectoryPrefix(targets: readonly string[]): string {
  const directories: string[][] = [];
  for (const target of targets) {
    directories.push(splitDirectorySegments(target));
  }
  if (directories.length === 0) {
    return "";
  }
  let shared = directories[0]!;
  for (const segments of directories.slice(1)) {
    shared = findSharedLeadingSegments(shared, segments);
  }
  return shared.join("/");
}

// A target's directory, as segments; never its basename, so a lone file keeps its own name.
function splitDirectorySegments(target: string): string[] {
  return target.split("/").slice(0, -1);
}

// The leading segments two paths agree on.
function findSharedLeadingSegments(left: readonly string[], right: readonly string[]): string[] {
  const shared: string[] = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    shared.push(left[index]!);
  }
  return shared;
}

// Shape flat Files entries into a nested tree below their shared directory prefix. Folders sort before files, then alphabetically.
export function buildFileTree(files: readonly FileSidebarEntry[]): FileTreeNode[] {
  const targets: string[] = [];
  for (const file of files) {
    targets.push(file.target);
  }
  const prefix = findCommonDirectoryPrefix(targets);
  const root = createFolderNode("");
  for (const file of files) {
    insertFileIntoTree(root, file, prefix);
  }
  sortTreeNodes(root);
  mergeSingleChildFolderChains(root.children);
  return root.children;
}

function createFolderNode(name: string): FileTreeNode {
  return { kind: FOLDER_NODE_KIND, name, children: [], entry: undefined };
}

// Walk (creating as needed) the folder chain below the stripped prefix, then hang the file leaf.
function insertFileIntoTree(root: FileTreeNode, file: FileSidebarEntry, prefix: string): void {
  const segments = splitSegmentsBelowPrefix(file.target, prefix);
  const fileName = segments[segments.length - 1]!;
  let folder = root;
  for (const directory of segments.slice(0, -1)) {
    folder = findOrAddFolder(folder, directory);
  }
  folder.children.push({ kind: FILE_NODE_KIND, name: fileName, children: [], entry: file });
}

// A target's non-empty segments below the shared prefix; splitting the remainder removes the deep absolute root.
function splitSegmentsBelowPrefix(target: string, prefix: string): string[] {
  const remainder = target.slice(prefix.length);
  const segments: string[] = [];
  for (const segment of remainder.split("/")) {
    if (segment !== "") {
      segments.push(segment);
    }
  }
  return segments;
}

function findOrAddFolder(parent: FileTreeNode, name: string): FileTreeNode {
  for (const child of parent.children) {
    const isFolder = child.kind === FOLDER_NODE_KIND;
    const hasName = child.name === name;
    const isMatch = isFolder && hasName;
    if (isMatch) {
      return child;
    }
  }
  const folder = createFolderNode(name);
  parent.children.push(folder);
  return folder;
}

// Folders before files, then alphabetical, at every depth.
function sortTreeNodes(folder: FileTreeNode): void {
  folder.children.sort(compareTreeNodes);
  for (const child of folder.children) {
    sortTreeNodes(child);
  }
}

function compareTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.kind !== right.kind) {
    return left.kind === FOLDER_NODE_KIND ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

// Merge folder-in-folder chains into one `a/b/c` node (task 90). Runs after sorting.
function mergeSingleChildFolderChains(nodes: FileTreeNode[]): void {
  for (const node of nodes) {
    while (isFolderHoldingOnlyFolder(node)) {
      const onlyChild = node.children[0]!;
      node.name = `${node.name}/${onlyChild.name}`;
      node.children = onlyChild.children;
    }
    mergeSingleChildFolderChains(node.children);
  }
}

// True when the node is a folder whose single child is itself a folder: the mergeable link.
function isFolderHoldingOnlyFolder(node: FileTreeNode): boolean {
  const isFolder = node.kind === FOLDER_NODE_KIND;
  const hasOneChild = node.children.length === 1;
  const isSingleChildFolder = isFolder && hasOneChild;
  if (!isSingleChildFolder) {
    return false;
  }
  return node.children[0]!.kind === FOLDER_NODE_KIND;
}
