// File-history view model (DOM-free): wire shapes, revision text, revision anchoring, changeId lookup, diff block slicing.

// Wire shapes (JSON off the server: ids, paths and dates are plain strings).
type WireRename = { from: string; to: string };
// Each line's last value is its believed text at this revision.
type WireLineEntry = { values: { line: string }[] };
type WireRevision = { kind: string; changeId: string; timestamp: string; rename?: WireRename; lines?: WireLineEntry[] };
type WireFileHistory = { target: string; revisions: WireRevision[] };
// The minimal shape the changeId lookups read; WireFileHistory satisfies it.
export type WireRevisionRef = { changeId: string; timestamp?: string };
export type WireFileHistoryRef = { target: string; revisions: WireRevisionRef[] };
export type WireDocument = { filesTouched: WireFileHistory[] };

// The last value of each line, newline-joined: matches the server's renderRevisionText.
function renderRevisionText(revision: WireRevision): string {
  const lineTexts: string[] = [];
  for (const entry of revision.lines ?? []) {
    lineTexts.push(entry.values[entry.values.length - 1]!.line);
  }
  return lineTexts.join("\n");
}

function buildRevisionViewModels(history: WireFileHistory) {
  const revisions = [];
  for (const revision of history.revisions) {
    revisions.push({
      kind: revision.kind,
      changeId: revision.changeId,
      timestamp: revision.timestamp,
      content: renderRevisionText(revision),
      rename: revision.rename,
    });
  }
  return revisions;
}

// Revisions are oldest first. An unknown path gives empty revisions, never a throw.
export function buildFileHistoryViewModel(document: WireDocument, path: string) {
  for (const history of document.filesTouched) {
    if (history.target === path) {
      return { path, revisions: buildRevisionViewModels(history) };
    }
  }
  return { path, revisions: [] };
}

// The 0-based index named by a route's 1-based /rev/<n> segment, or undefined when invalid or out of range.
export function computeAnchoredRevisionIndex(anchorRev: string | undefined, revisionCount: number): number | undefined {
  const revisionIndex = Number(anchorRev) - 1;
  const isInteger = Number.isInteger(revisionIndex);
  if (!isInteger) {
    return undefined;
  }
  if (revisionIndex < 0) {
    return undefined;
  }
  if (revisionIndex >= revisionCount) {
    return undefined;
  }
  return revisionIndex;
}

// changeId -> 0-based raw JSONL line index: the first line containing the changeId, or -1.
// ponytail: linear substring scan per changeId; fine at transcript scale.
export function findLineForChangeId(rawLines: string[], changeId: string): number {
  for (let index = 0; index < rawLines.length; index++) {
    const containsChangeId = rawLines[index]!.includes(changeId);
    if (containsChangeId) {
      return index;
    }
  }
  return -1;
}

// The 1-based number of the last revision at or before `timestamp` (ISO strings), or undefined.
function computeRevisionNumberAtTime(revisions: WireRevisionRef[], timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  let revisionNumber: number | undefined;
  for (let index = 0; index < revisions.length; index++) {
    const revisionTimestamp = revisions[index]!.timestamp;
    if (revisionTimestamp === undefined) {
      continue;
    }
    if (revisionTimestamp <= timestamp) {
      revisionNumber = index + 1;
    }
  }
  return revisionNumber;
}

// A backup blob name (`<hex>@vN`); the capture group is the per-file prefix the fallback keys on.
const BACKUP_BLOB_CHANGE_ID = /^(.+@)v\d+$/;

// True when the changeId names a File History Snapshot blob; toolu ids have no snapshot to jump to.
export function isChangeIdBackupBlobName(changeId: string): boolean {
  return BACKUP_BLOB_CHANGE_ID.test(changeId);
}

function findRevisionIndex(revisions: WireRevisionRef[], changeId: string): number {
  for (let index = 0; index < revisions.length; index++) {
    if (revisions[index]!.changeId === changeId) {
      return index;
    }
  }
  return -1;
}

function containsChangeIdPrefix(revisions: WireRevisionRef[], prefix: string): boolean {
  for (const revision of revisions) {
    const hasPrefix = revision.changeId.startsWith(prefix);
    if (hasPrefix) {
      return true;
    }
  }
  return false;
}

// The target and 1-based revision number for a changeId; a blob name falls back to the revision at backupTime.
export function findRevisionForChangeId(filesTouched: WireFileHistoryRef[], changeId: string, backupTime?: string) {
  for (const history of filesTouched) {
    const index = findRevisionIndex(history.revisions, changeId);
    if (index >= 0) {
      return { target: history.target, revisionNumber: index + 1 };
    }
  }
  const blobMatch = BACKUP_BLOB_CHANGE_ID.exec(changeId);
  if (blobMatch === null) {
    return undefined;
  }
  for (const history of filesTouched) {
    const hasFilePrefix = containsChangeIdPrefix(history.revisions, blobMatch[1]!);
    if (hasFilePrefix) {
      return { target: history.target, revisionNumber: computeRevisionNumberAtTime(history.revisions, backupTime) };
    }
  }
  return undefined;
}
