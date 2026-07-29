// Task 201 (spec S4): collectSnapshotBeaconNodes — file-history snapshots become verified beacon nodes, each resolved through its OWNING session's sidecar (Q12): the same `abc123@vN` blob name in two sessions must yield each session's own bytes, never a global lookup's.  Records are fabricated in memory (precedent: tests/reconstruction_sidecar.test.ts); the reader is a fake keyed by sessionId, so no disk file-history is ever touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import { LayeredNodeKind, RecordType } from "../src/structures/vocabulary.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { collectSnapshotBeaconNodes } from "../src/layered_snapshot_beacons.ts";

const SESSION_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SESSION_B = "bbbbbbbb-0000-0000-0000-000000000002";

// A synthetic envelope record carrying the transcript's cwd and its session's id — the snapshot records that follow it belong to this session.
function buildSessionCwdRecord(cwd: string, sessionId: string): TranscriptRecord {
    return { type: RecordType.user, cwd: new Path(cwd), sessionId: new Uuid(sessionId) } as unknown as TranscriptRecord;
}

// A file-history snapshot backing up `path` into blob `backupFileName` at `backupTime` (null backupFileName = version 1, which holds no blob).
function buildSnapshotRecord(path: string, backupFileName: string | null, backupTime: string): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: "m-" + backupTime,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: "m-" + backupTime,
            timestamp: backupTime,
            trackedFileBackups: { [path]: { backupFileName, version: 2, backupTime } },
        },
    } as unknown as TranscriptRecord;
}

test("test_collectSnapshotBeaconNodes_resolves_each_snapshot_through_its_owning_session", () => {
    // Scenario: sessions A and B both name their f.txt blob "abc123@v2"; each beacon must carry ITS session's bytes — a global name lookup would hand one session's bytes to both.
    const records = [
        buildSessionCwdRecord("/work", SESSION_A),
        buildSnapshotRecord("f.txt", "abc123@v2", "2026-01-01T00:00:10Z"),
        buildSessionCwdRecord("/work", SESSION_B),
        buildSnapshotRecord("f.txt", "abc123@v2", "2026-01-01T00:01:10Z"),
    ];
    const reader: BackupReader = (_name, sessionId) =>
        sessionId?.toString() === SESSION_A ? "bytes A\n" : "bytes B\n";
    const beaconsByFile = collectSnapshotBeaconNodes(records, reader);
    const beacons = beaconsByFile.get("/work/f.txt");
    assert.ok(beacons, "no beacons for /work/f.txt");
    assert.equal(beacons.length, 2);
    assert.equal(beacons[0]!.kind, LayeredNodeKind.beacon);
    assert.equal(beacons[1]!.kind, LayeredNodeKind.beacon);
    // backupTime order, each session's own bytes.
    assert.equal(beacons[0]!.instant.toISOString(), "2026-01-01T00:00:10.000Z");
    assert.equal(beacons[0]!.content, "bytes A\n");
    assert.equal(beacons[1]!.instant.toISOString(), "2026-01-01T00:01:10.000Z");
    assert.equal(beacons[1]!.content, "bytes B\n");
});

test("test_collectSnapshotBeaconNodes_skips_null_backup_blobs", () => {
    // Scenario: a version-1 snapshot (null backupFileName) holds no blob and contributes no beacon; a path with ONLY null backups gets no map entry at all.
    const records = [
        buildSessionCwdRecord("/work", SESSION_A),
        buildSnapshotRecord("f.txt", null, "2026-01-01T00:00:05Z"),
    ];
    const reader: BackupReader = () => {
        throw new Error("a null backup must never reach the reader");
    };
    const beaconsByFile = collectSnapshotBeaconNodes(records, reader);
    assert.equal(beaconsByFile.get("/work/f.txt"), undefined);
});
