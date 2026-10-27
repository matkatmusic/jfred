// Tests for the inspector's pure helpers: backup-time lookup for blob names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findBackupTimeForBlob } from "../webapp/inspector-links.ts";

test("test_findBackupTimeForBlob_returns_the_snapshot_entrys_backup_time", () => {
    // Scenario: a file-history-snapshot record maps tracked files to backup blobs with times.
    const record = {
        type: "file-history-snapshot",
        snapshot: {
            trackedFileBackups: {
                "inventory.py": { backupFileName: "5436e8e9f917cd04@v2", version: 2, backupTime: "2026-06-27T04:29:36.586Z" },
                "rename_inv.py": { backupFileName: null, version: 1, backupTime: "2026-06-27T04:29:44.173Z" },
            },
        },
    };
    // look up the blob's entry.
    const backupTime = findBackupTimeForBlob(record, "5436e8e9f917cd04@v2");
    // its backupTime comes back.
    assert.equal(backupTime, "2026-06-27T04:29:36.586Z");
});

test("test_findBackupTimeForBlob_returns_undefined_for_records_without_that_blob", () => {
    // Scenario: ordinary records carry no trackedFileBackups (and null backup names never match).  Steps: look the blob up in a plain message record and in a snapshot without it.
    assert.equal(findBackupTimeForBlob({ type: "user", message: {} }, "abc@v2"), undefined);
    assert.equal(findBackupTimeForBlob({ snapshot: { trackedFileBackups: { "a.py": { backupFileName: null } } } }, "abc@v2"), undefined);
});
