// A snapshot wire node ships isBackupMissing only when its file-history backup file is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { createFixtureDiskFolder, createFixtureRepo, DISK_ONLY_FILE_MTIME } from "./layer1-view-test-helpers.ts";

const SESSION = "b21d84c5-0000-0000-0000-000000000001";
const BLOB_NAME = "bbb222@v1";

function writeSessionWithOneSnapshot(treeRoot: string, diskDir: string): Path {
    const projectDir = join(treeRoot, "projects", "-demo");
    mkdirSync(projectDir, { recursive: true });
    const backupTime = new Date(DISK_ONLY_FILE_MTIME).toISOString();
    const records = [
        { type: RecordType.user, cwd: diskDir, sessionId: SESSION, message: { role: "user", content: "hi" } },
        {
            type: RecordType.fileHistorySnapshot,
            messageId: "m-1",
            isSnapshotUpdate: false,
            snapshot: {
                messageId: "m-1",
                timestamp: backupTime,
                trackedFileBackups: { "disk-only.txt": { backupFileName: BLOB_NAME, version: 1, backupTime } },
            },
        },
    ];
    const jsonlPath = join(projectDir, `${SESSION}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(jsonlPath);
}

function readOrphanSnapshot(sessionFile: Path, diskDir: string): { isBackupMissing?: boolean } {
    const view = buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD", undefined, undefined, [sessionFile]);
    return view.diskOrphans.find((candidate) => candidate.path.toString() === "disk-only.txt")!.snapshots![0]!;
}

test("test_buildLayer1View_flags_a_snapshot_node_whose_backup_file_is_missing", () => {
    const diskDir = createFixtureDiskFolder();
    const treeRoot = createTempDir();
    mkdirSync(join(treeRoot, "file-history"), { recursive: true });
    const snapshot = readOrphanSnapshot(writeSessionWithOneSnapshot(treeRoot, diskDir), diskDir);
    assert.equal(snapshot.isBackupMissing, true);
});

test("test_buildLayer1View_does_not_flag_a_snapshot_node_whose_backup_file_exists", () => {
    const diskDir = createFixtureDiskFolder();
    const treeRoot = createTempDir();
    mkdirSync(join(treeRoot, "file-history", SESSION), { recursive: true });
    writeFileSync(join(treeRoot, "file-history", SESSION, BLOB_NAME), "bytes\n");
    const snapshot = readOrphanSnapshot(writeSessionWithOneSnapshot(treeRoot, diskDir), diskDir);
    assert.equal(snapshot.isBackupMissing, undefined);
});
