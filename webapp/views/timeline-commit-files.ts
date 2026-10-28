// A commit row's changed-file list and highlight set: a two-direction walk skipping baseline seeds and orphans.

import { GIT_BASE_CHANGE_ID_PREFIX } from "./timeline-changes.ts";
import { COMMIT_NODE_KIND } from "./timeline-types.ts";
import type { FileChange, TimelineNode } from "./timeline-node-types.ts";

// True when the chip is a baseline seed; baseline state is pre-session, never a commit's delta.
function isChangeGitBaseline(change: FileChange): boolean {
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

export function computeCommitChangedFiles(nodes: TimelineNode[], commitIndex: number): FileChange[] {
  const commitWhen = nodes[commitIndex]!.when;
  const changes: FileChange[] = [];
  const seenPaths = new Set<string>();
  const collectChange = (change: FileChange): void => {
    const isBaseline = isChangeGitBaseline(change);
    if (isBaseline) {
      return;
    }
    const isSeen = seenPaths.has(change.path);
    if (isSeen) {
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
  const changedPaths = new Set<string>();
  for (const change of computeCommitChangedFiles(nodes, commitIndex)) {
    changedPaths.add(change.path);
  }
  // A chip contributes when it is no baseline seed, is not after the commit, and touches a changed path.
  const isChangeContributing = (change: FileChange): boolean => {
    const isBaseline = isChangeGitBaseline(change);
    if (isBaseline) {
      return false;
    }
    if (change.when > commitWhen) {
      return false;
    }
    return changedPaths.has(change.path);
  };
  const containsContributingChange = (node: TimelineNode): boolean => {
    for (const change of node.fileChanges ?? []) {
      const isContributing = isChangeContributing(change);
      if (isContributing) {
        return true;
      }
    }
    return false;
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
    const isContributor = containsContributingChange(node);
    if (isContributor) {
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
    const isContributor = containsContributingChange(node);
    if (isContributor) {
      indexes.push(index);
    }
  }
  return indexes;
}
