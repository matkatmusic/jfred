// Finds the snapshot record that produced the surviving working tree, by content signature, not version counter.

import type { TranscriptRecord } from "./structures/envelope.ts";
import {
  getFileHistorySnapshot,
  type FileHistoryBackup,
  type FileHistorySnapshotMessage,
} from "./structures/file-history.ts";
import { Path, Uuid } from "./structures/domain.ts";

// Placeholder content id for a tracked file with no backup yet; its first appearance still changes the path set.
const NEVER_BACKED_UP = "∅";

// The content identity of one tracked file: its last non-null backupFileName, carried across refresh snapshots.
function getContentId(
  path: Path,
  backup: FileHistoryBackup,
  carried: Map<string, string>,
): string {
  const key = path.toString();
  if (backup.backupFileName !== null) {
    carried.set(key, backup.backupFileName.toString());
  }
  return carried.get(key) ?? NEVER_BACKED_UP;
}

// A snapshot's content signature: sorted "<path>@<contentId>" parts; added or removed paths change it too.
function buildContentSignature(
  snapshot: FileHistorySnapshotMessage,
  carried: Map<string, string>,
): string {
  const backupEntries = snapshot.snapshot.trackedFileBackups.listEntries();
  const signatureParts: string[] = [];
  for (const [path, backup] of backupEntries) {
    signatureParts.push(`${path.toString()}@${getContentId(path, backup, carried)}`);
  }
  signatureParts.sort();
  return signatureParts.join("|");
}

// The messageId of the last snapshot whose content signature changed; undefined when none changed (caller uses the final head).
export function findWorkingTreeOwner(
  records: TranscriptRecord[],
): Uuid | undefined {
  let owner: Uuid | undefined;
  let previousSignature = "";
  const carried = new Map<string, string>();
  for (const record of records) {
    const snapshot = getFileHistorySnapshot(record);
    if (snapshot === undefined) {
      continue;
    }
    const signature = buildContentSignature(snapshot, carried);
    if (signature !== previousSignature) {
      owner = snapshot.messageId;
    }
    previousSignature = signature;
  }
  return owner;
}

