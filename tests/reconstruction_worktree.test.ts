import { test } from "node:test";
import assert from "node:assert/strict";
import { findWorkingTreeOwner } from "../src/reconstruction_worktree.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";

// A snapshot tracking one file; a null backupFileName models a refresh snapshot.
function buildSnapshotRecord(messageId: string, backupFileName: string | null, version: number): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId,
        isSnapshotUpdate: false,
        snapshot: {
            messageId,
            timestamp: "2026-01-01T00:00:00Z",
            trackedFileBackups: { "a.py": { backupFileName, version, backupTime: "2026-01-01T00:00:00Z" } },
        },
    } as unknown as TranscriptRecord;
}

test("test_owner_is_undefined_when_there_is_no_snapshot", () => {
    assert.equal(findWorkingTreeOwner([]), undefined);
});

test("test_owner_skips_refresh_snapshots_that_keep_the_same_content", () => {
    const records = [
        buildSnapshotRecord("m1", "h@v1", 1),
        buildSnapshotRecord("m2", null, 2),
    ];
    assert.equal(findWorkingTreeOwner(records)?.toString(), "m1");
});

test("test_owner_is_the_last_snapshot_whose_content_changed", () => {
    const records = [
        buildSnapshotRecord("m1", "h@v1", 1),
        buildSnapshotRecord("m2", null, 2),
        buildSnapshotRecord("m3", "h@v3", 3),
    ];
    assert.equal(findWorkingTreeOwner(records)?.toString(), "m3");
});
