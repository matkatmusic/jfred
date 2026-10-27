// A lane node resolved to its wire instant.

import type { WireCommit, WireLayer1View, WireSnapshot } from "./layer1-wire.ts";

function findByKey<T, K extends keyof T>(entries: readonly T[], key: K, value: T[K]): T | undefined {
  for (const entry of entries) {
    const isMatch = entry[key] === value;
    if (isMatch) {
      return entry;
    }
  }
  return undefined;
}

function findSnapshotInstant(snapshots: readonly WireSnapshot[], version: string | undefined, sessionId: string | undefined): string | undefined {
  for (const snapshot of snapshots) {
    const isVersionMatch = String(snapshot.version) === version;
    const isSessionMatch = snapshot.sessionId === sessionId;
    const isNodeSnapshot = isVersionMatch && isSessionMatch;
    if (isNodeSnapshot) {
      return snapshot.instant;
    }
  }
  return undefined;
}

// hash for a commit, version+session for a snapshot, else on-disk.
export function readNodeInstant(view: WireLayer1View, path: string, node: HTMLElement): string | undefined {
  const pair = findByKey(view.pairs, "path", path);
  const orphan = findByKey(view.diskOrphans, "path", path);
  const isCommit = node.classList.contains("n-commit");
  const isSnapshot = node.classList.contains("n-snap");
  const isEdit = node.classList.contains("n-edit");
  const isRead = node.classList.contains("n-read");
  const isEditOrRead = isEdit || isRead;
  if (isCommit) {
    const commits: readonly WireCommit[] = pair?.commits ?? [];
    return findByKey(commits, "hash", node.title)?.instant;
  }
  if (isSnapshot) {
    return findSnapshotInstant(pair?.snapshots ?? orphan?.snapshots ?? [], node.dataset.version, node.dataset.sessionId);
  }
  if (isEditOrRead) {
    return node.dataset.instant;
  }
  return (pair?.onDisk ?? orphan)?.instant;
}
