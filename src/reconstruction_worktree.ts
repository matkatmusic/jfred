// Which working-tree state survived a session. The harness re-snapshots tracked files after every turn; the LAST file-history-snapshot whose CONTENT signature differs from the previous one marks the last time the working tree actually changed. Content identity is the carried-forward `backupFileName` per path, NOT the `version` counter: a `code` restore with no post-edit emits trailing "refresh" snapshots that bump each file's version while leaving its content (and backupFileName) unchanged, so version would falsely report a change. The owner's `messageId` names the conversation record that produced the surviving files. See plans/s9/s9-reconstruction-plan.md (refines plans/s8/).

import type { TranscriptRecord } from "./structures/envelope.ts";
import {
    getFileHistorySnapshot,
    type FileHistoryBackup,
    type FileHistorySnapshotMessage,
} from "./structures/file-history.ts";
import { Path, Uuid } from "./structures/domain.ts";

// Placeholder content id for a file that has been tracked but never yet backed up (its first tracked version reports backupFileName = null). Such a file is still detected as a working-tree change by the PATH-SET change when it first appears (see buildContentSignature).
const NEVER_BACKED_UP = "∅";

// The content identity of one tracked file: its last-known non-null backupFileName, carried forward across refresh snapshots that re-version unchanged content with a null backupFileName. Updates `carried` for this path when the snapshot supplies a real backupFileName.
function resolveContentId(
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

// A signature of a snapshot's working-tree CONTENT: each tracked file as "<path>@<contentId>", sorted.  Unlike the version counter (which the harness bumps on every refresh snapshot), the carried backupFileName changes only when a file's content is actually re-backed-up — so two snapshots with the same signature represent the same on-disk content even if their version numbers differ. A new or removed path also changes the signature (so a freshly written file, whose first backupFileName is null, is still detected).
function buildContentSignature(
    snapshot: FileHistorySnapshotMessage,
    carried: Map<string, string>,
): string {
    const backupEntries = snapshot.snapshot.trackedFileBackups.entries();
    const signatureParts = backupEntries.map(([path, backup]) => `${path.toString()}@${resolveContentId(path, backup, carried)}`);
    signatureParts.sort();
    return signatureParts.join("|");
}

// The messageId of the last file-history-snapshot whose CONTENT signature changed vs. the previous snapshot — the record that produced the surviving working tree. A `code` restore with no post-edit emits trailing refresh snapshots whose content is unchanged (bumped version, null backupFileName); those keep the same signature and are correctly ignored. undefined when there is no snapshot or the content never changes (the caller then falls back to the final head).
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

