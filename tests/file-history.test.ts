import { test } from "node:test";
import assert from "node:assert/strict";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    getFileHistorySnapshot,
    type FileHistorySnapshotMessage,
} from "../src/structures/file-history.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S1_JSONL } from "./fixtures.ts";

function collectSnapshots(
    records: TranscriptRecord[],
): FileHistorySnapshotMessage[] {
    const snapshots: FileHistorySnapshotMessage[] = [];
    for (const record of records) {
        const snapshot = getFileHistorySnapshot(record);
        if (snapshot) {
            snapshots.push(snapshot);
        }
    }
    return snapshots;
}

test("test_file_history_snapshot_exposes_tracked_file_backups", () => {
    // Scenario: the file-history-snapshot records expose per-path backups, and s1_delete.py is tracked with a numeric version and a nullable backupFileName.  Steps: collect every file-history-snapshot record in s1.
    const records = loadRecords(S1_JSONL);
    const snapshots = collectSnapshots(records);
    // every file-history-snapshot record is exposed — none dropped.
    const snapshotRecords = records.filter(
        (record) => record.type === RecordType.fileHistorySnapshot,
    );
    assert.equal(snapshots.length, snapshotRecords.length);
    assert.ok(snapshots.length > 0);
    // the snapshot's ids and times are domain objects, not primitives.
    const first = snapshots[0]!;
    assert.ok(first.messageId instanceof Uuid);
    assert.ok(first.snapshot.timestamp instanceof Date);
    // at least one snapshot tracks the path s1_delete.py, looked up by Path.
    const target = new Path("s1_delete.py");
    const tracking = snapshots.find(
        (snapshot) => snapshot.snapshot.trackedFileBackups.has(target),
    );
    if (!tracking) {
        assert.fail("expected a snapshot tracking s1_delete.py");
    }
    // its keys are Path objects.
    assert.ok(tracking.snapshot.trackedFileBackups.paths()[0] instanceof Path);
    // its backup carries a numeric version, a Date backupTime, and a Path|null backupFileName.
    const backup = tracking.snapshot.trackedFileBackups.get(target);
    if (!backup) {
        assert.fail("expected a backup entry for s1_delete.py");
    }
    assert.equal(typeof backup.version, "number");
    assert.ok(backup.backupTime instanceof Date);
    assert.ok(backup.backupFileName === null || backup.backupFileName instanceof Path);
});

