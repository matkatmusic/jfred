// A commit row's changed-file list and highlight set: a two-direction walk skipping baseline seeds and orphans.

import { GIT_BASE_CHANGE_ID_PREFIX } from "./timeline-changes.ts";
import { COMMIT_NODE_KIND } from "./timeline-types.ts";
import type { FileChange, TimelineNode } from "./timeline-node-types.ts";

// True when the chip is a baseline seed; baseline state is pre-session, never a commit's delta.
function checkChangeIsGitBaseline(change: FileChange): boolean {
  if (change.changeId === undefined) {
    return false;
  }
  return change.changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX);
}

// A commit's changed-file list: walk back to the previous commit, then forward over pre-commit chips.
function collectChangesAtOrBeforeCommit(node: TimelineNode, commitWhen: string, collectChange: (change: FileChange) => void): void {
  for (const change of node.fileChanges ?? []) {
    if (change.when > commitWhen) {
      continue;
    }
    collectChange(change);
  }
}

export function deriveCommitChangedFiles(nodes: TimelineNode[], commitIndex: number): FileChange[] {
  const commitWhen = nodes[commitIndex]!.when;
  const changes: FileChange[] = [];
  const seenPaths = new Set<string>();
  const collectChange = (change: FileChange): void => {
    if (checkChangeIsGitBaseline(change)) {
      return;
    }
    if (seenPaths.has(change.path)) {
      return;
    }
    seenPaths.add(change.path);
    changes.push(change);
  };
  for (let index = commitIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (node.kind === COMMIT_NODE_KIND) {
      break;
    }
    if (node.isOrphaned === true) {
      continue;
    }
    for (const change of node.fileChanges ?? []) {
      collectChange(change);
    }
  }
  for (let index = commitIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind === COMMIT_NODE_KIND) {
      break;
    }
    if (node.isOrphaned === true) {
      continue;
    }
    collectChangesAtOrBeforeCommit(node, commitWhen, collectChange);
  }
  return changes;
}

// The rows a selected commit highlights: rows whose qualifying changes overlap the commit's paths, ascending.
export function findContributingNodeIndexes(nodes: TimelineNode[], commitIndex: number): number[] {
  const commitWhen = nodes[commitIndex]!.when;
  const changedPaths = new Set(deriveCommitChangedFiles(nodes, commitIndex).map((change) => change.path));
  // A chip contributes when it is no baseline seed, is at or before the commit, and touches a changed path.
  const checkChangeContributes = (change: FileChange): boolean => {
    if (checkChangeIsGitBaseline(change)) {
      return false;
    }
    if (change.when > commitWhen) {
      return false;
    }
    return changedPaths.has(change.path);
  };
  const indexes: number[] = [];
  for (let index = commitIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (node.kind === COMMIT_NODE_KIND) {
      break;
    }
    if (node.isOrphaned === true) {
      continue;
    }
    if ((node.fileChanges ?? []).some(checkChangeContributes)) {
      indexes.push(index);
    }
  }
  indexes.reverse();
  for (let index = commitIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind === COMMIT_NODE_KIND) {
      break;
    }
    if (node.isOrphaned === true) {
      continue;
    }
    if ((node.fileChanges ?? []).some(checkChangeContributes)) {
      indexes.push(index);
    }
  }
  return indexes;
}
