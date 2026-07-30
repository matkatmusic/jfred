// Task 310 (spec S19): collectSnapshotPlacements. Temp-tree fixtures load via loadTranscript, so the live ~/.claude/file-history is never reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { collectSnapshotPlacements } from "../src/layer1_snapshots.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const SESSION_ONE = "b21d84c5-0000-0000-0000-000000000001";
const SESSION_TWO = "d4a06b8f-0000-0000-0000-000000000002";
const SHARED_BLOB = "abc123@v2";

function buildSessionCwdRecord(cwd: string, sessionId: string): object {
    return { type: RecordType.user, cwd, sessionId, message: { role: "user", content: "hi" } };
}

function buildSnapshotRecord(path: string, backupFileName: string | null, version: number, backupTime: string): object {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: `m-${backupTime}`,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: `m-${backupTime}`,
            timestamp: backupTime,
            trackedFileBackups: { [path]: { backupFileName, version, backupTime } },
        },
    };
}

// A copied-out-of-~/.claude tree, which is what deriveSiblingFileHistoryRoot needs.
function writeSessionTranscript(treeRoot: string, sessionId: string, records: object[]): Path {
    const projectDir = join(treeRoot, "projects", "-demo");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(treeRoot, "file-history"), { recursive: true });
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(jsonlPath);
}

function writeBlob(treeRoot: string, sessionId: string, blobName: string, content: string): void {
    const blobDir = join(treeRoot, "file-history", sessionId);
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, blobName), content);
}

test("test_collectSnapshotPlacements_keeps_each_session_as_the_owner_of_its_own_version", () => {
    // Scenario: two sessions name one blob "abc123@v2" with different bytes; losing the owner reads the wrong bytes.
    const treeRoot = makeTempDir();
    // Session ONE snapshots util.ts into abc123@v2 at T1.
    const sessionOneFile = writeSessionTranscript(treeRoot, SESSION_ONE, [
        buildSessionCwdRecord("/work", SESSION_ONE),
        buildSnapshotRecord("src/util.ts", SHARED_BLOB, 2, "2026-06-03T10:30:00.000Z"),
    ]);
    writeBlob(treeRoot, SESSION_ONE, SHARED_BLOB, "bytes A\n");
    // Session TWO snapshots the SAME path under the SAME blob name at a later T2.
    const sessionTwoFile = writeSessionTranscript(treeRoot, SESSION_TWO, [
        buildSessionCwdRecord("/work", SESSION_TWO),
        buildSnapshotRecord("src/util.ts", SHARED_BLOB, 2, "2026-07-24T08:00:00.000Z"),
    ]);
    writeBlob(treeRoot, SESSION_TWO, SHARED_BLOB, "bytes B\n");

    const placementsByPath = collectSnapshotPlacements([sessionOneFile, sessionTwoFile]);
    const placements = placementsByPath.get("/work/src/util.ts");
    assert.ok(placements, "no placements for /work/src/util.ts");
    // Both sessions contribute, ordered by instant.
    assert.equal(placements.length, 2);
    assert.equal(placements[0]!.instant.toISOString(), "2026-06-03T10:30:00.000Z");
    assert.equal(placements[1]!.instant.toISOString(), "2026-07-24T08:00:00.000Z");
    // Each placement names its OWN owning session and transcript.
    assert.equal(placements[0]!.sessionId.toString(), SESSION_ONE);
    assert.equal(placements[1]!.sessionId.toString(), SESSION_TWO);
    assert.equal(placements[0]!.sessionFile.toString(), sessionOneFile.toString());
    assert.equal(placements[1]!.sessionFile.toString(), sessionTwoFile.toString());
    // @vN is per session: both are version 2 under the same blob name.
    assert.equal(placements[0]!.version, 2);
    assert.equal(placements[1]!.version, 2);
    assert.equal(placements[0]!.backupFileName.toString(), SHARED_BLOB);
    assert.equal(placements[1]!.backupFileName.toString(), SHARED_BLOB);
    // The snapshot record sits on line 2 of each fixture transcript.
    assert.equal(placements[0]!.line, 2);
    assert.equal(placements[1]!.line, 2);
    // Reading each placement through its OWN session's reader yields that session's bytes.
    const readerOne = buildSidecarReader(loadTranscript(sessionOneFile.toString()).records);
    const readerTwo = buildSidecarReader(loadTranscript(sessionTwoFile.toString()).records);
    assert.equal(readerOne!(placements[0]!.backupFileName, placements[0]!.sessionId), "bytes A\n");
    assert.equal(readerTwo!(placements[1]!.backupFileName, placements[1]!.sessionId), "bytes B\n");
});

test("test_collectSnapshotPlacements_skips_a_snapshot_with_no_blob", () => {
    // Scenario: a null backupFileName holds no blob, so it can never be shown or fetched.
    const treeRoot = makeTempDir();
    const sessionFile = writeSessionTranscript(treeRoot, SESSION_ONE, [
        buildSessionCwdRecord("/work", SESSION_ONE),
        buildSnapshotRecord("notes.txt", null, 1, "2026-07-23T19:40:00.000Z"),
    ]);
    const placementsByPath = collectSnapshotPlacements([sessionFile]);
    // No entry at all, not an empty array.
    assert.equal(placementsByPath.get("/work/notes.txt"), undefined);
});

test("test_collectSnapshotPlacements_records_a_repeated_snapshot_entry_once", () => {
    // Scenario: snapshot records are cumulative; one real transcript repeats a single entry 101 times.
    const treeRoot = makeTempDir();
    const repeated = buildSnapshotRecord("src/index.ts", "def456@v3", 3, "2026-07-24T08:15:00.000Z");
    const sessionFile = writeSessionTranscript(treeRoot, SESSION_TWO, [
        buildSessionCwdRecord("/work", SESSION_TWO),
        repeated,
        repeated,
        repeated,
    ]);
    const placements = collectSnapshotPlacements([sessionFile]).get("/work/src/index.ts");
    assert.ok(placements, "no placements for /work/src/index.ts");
    assert.equal(placements.length, 1);
    // The FIRST record's line — where the snapshot was taken, which selects the title in effect.
    assert.equal(placements[0]!.line, 2);
    assert.equal(placements[0]!.sessionId.toString(), SESSION_TWO);
    assert.deepEqual(placements[0]!.path, new Path("/work/src/index.ts"));
    assert.ok(placements[0]!.sessionId instanceof Uuid);
});
