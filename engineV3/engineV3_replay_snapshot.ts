// Lists what changed between two folder scans, as the "changes" array of an event file.

import { FileKind, type FileStamp } from "./engineV3_replay_snapshot_scan.ts";

export enum ChangeKind {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
}

export type FileChange = {
  path: string;
  change: ChangeKind;
  mode?: string;
  contentHash?: string;
  symlinkTarget?: string;
  directory?: true;
};

const CONTENT_STAMP_KEYS = ["kind", "mode", "contentHash", "symlinkTarget"] as const;
const AFTER_ALL_SEGMENTS = "￿";

function createFileChange(path: string, stamp: FileStamp, change: ChangeKind): FileChange {
  const entry: FileChange = { path, change };
  if (stamp.kind === FileKind.Symlink) {
    entry.symlinkTarget = stamp.symlinkTarget;
    return entry;
  }
  entry.mode = stamp.mode;
  if (stamp.kind === FileKind.Directory) {
    entry.directory = true;
  }
  if (stamp.kind === FileKind.File) {
    entry.contentHash = stamp.contentHash;
  }
  return entry;
}

function isContentChanged(previous: FileStamp, current: FileStamp): boolean {
  for (const key of CONTENT_STAMP_KEYS) {
    if (previous[key] !== current[key]) {
      return true;
    }
  }
  return false;
}

function getChangeKind(previous: FileStamp | undefined, current: FileStamp): ChangeKind | undefined {
  if (previous === undefined) {
    return ChangeKind.Added;
  }
  const isChanged = isContentChanged(previous, current);
  if (isChanged) {
    return ChangeKind.Modified;
  }
  return undefined;
}

// A deleted path sorts after everything inside it, because its key ends with a segment that is larger than any name.
function buildSortKey(change: FileChange): string[] {
  const segments = change.path.split("/");
  if (change.change === ChangeKind.Deleted) {
    segments.push(AFTER_ALL_SEGMENTS);
  }
  return segments;
}

function compareChanges(first: FileChange, second: FileChange): number {
  const firstKey = buildSortKey(first);
  const secondKey = buildSortKey(second);
  const sharedLength = Math.min(firstKey.length, secondKey.length);
  for (let index = 0; index < sharedLength; index++) {
    if (firstKey[index]! < secondKey[index]!) {
      return -1;
    }
    if (firstKey[index]! > secondKey[index]!) {
      return 1;
    }
  }
  return firstKey.length - secondKey.length;
}

function collectDeletedChanges(previous: Map<string, FileStamp>, current: Map<string, FileStamp>): FileChange[] {
  const deletedChanges: FileChange[] = [];
  for (const path of previous.keys()) {
    const isStillPresent = current.has(path);
    if (!isStillPresent) {
      deletedChanges.push({ path, change: ChangeKind.Deleted });
    }
  }
  return deletedChanges;
}

export function listChangesSinceLastScan(previous: Map<string, FileStamp>, current: Map<string, FileStamp>): FileChange[] {
  const changes = collectDeletedChanges(previous, current);
  for (const [path, stamp] of current) {
    const change = getChangeKind(previous.get(path), stamp);
    if (change !== undefined) {
      changes.push(createFileChange(path, stamp, change));
    }
  }
  return changes.sort(compareChanges);
}
