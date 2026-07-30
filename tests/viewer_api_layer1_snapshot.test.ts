// Task 313 (spec S19): the snapshot form of /api/layer1-file, on temp-tree fixtures via loadTranscript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { readSnapshotFileContent, isSnapshotFileRequest } from "../src/viewer_api_layer1_snapshot.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const SESSION_ONE = "b21d84c5-0000-0000-0000-000000000001";
const SESSION_TWO = "d4a06b8f-0000-0000-0000-000000000002";
const SHARED_BLOB = "abc123@v2";
const CWD = "/work";
const RELATIVE_PATH = "src/util.ts";

function buildSessionCwdRecord(sessionId: string): object {
    return { type: RecordType.user, cwd: CWD, sessionId, message: { role: "user", content: "hi" } };
}

function buildSnapshotRecord(backupFileName: string | null, version: number, backupTime: string): object {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: `m-${backupTime}`,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: `m-${backupTime}`,
            timestamp: backupTime,
            trackedFileBackups: { [`${CWD}/${RELATIVE_PATH}`]: { backupFileName, version, backupTime } },
        },
    };
}

// A copied-out-of-~/.claude tree, which is what deriveSiblingFileHistoryRoot needs.
function writeSession(treeRoot: string, sessionId: string, backupTime: string): Path {
    const projectDir = join(treeRoot, "projects", "-demo");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(treeRoot, "file-history"), { recursive: true });
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    const records = [buildSessionCwdRecord(sessionId), buildSnapshotRecord(SHARED_BLOB, 2, backupTime)];
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(jsonlPath);
}

function writeBlob(treeRoot: string, sessionId: string, content: string): void {
    const blobDir = join(treeRoot, "file-history", sessionId);
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, SHARED_BLOB), content);
}

function snapshotQuery(sessionFile: Path, sessionId: string): URLSearchParams {
    return new URLSearchParams({
        snapshotSession: sessionFile.toString(),
        sessionId,
        version: "2",
        path: RELATIVE_PATH,
        dir: CWD,
    });
}

test("test_snapshot_form_reads_owning_session_bytes_for_a_shared_blob_name", () => {
    // Scenario: both sessions name one blob "abc123@v2"; the session id must select the right bytes.
    const treeRoot = makeTempDir();
    const sessionOne = writeSession(treeRoot, SESSION_ONE, "2026-06-03T10:30:00.000Z");
    writeBlob(treeRoot, SESSION_ONE, "bytes A\n");
    const sessionTwo = writeSession(treeRoot, SESSION_TWO, "2026-07-24T08:00:00.000Z");
    writeBlob(treeRoot, SESSION_TWO, "bytes B\n");

    assert.equal(readSnapshotFileContent(snapshotQuery(sessionOne, SESSION_ONE)).content, "bytes A\n");
    assert.equal(readSnapshotFileContent(snapshotQuery(sessionTwo, SESSION_TWO)).content, "bytes B\n");
});

// Task 317: a session renamed part-way through must attribute each snapshot to the title over ITS line.
test("test_snapshot_form_returns_the_customTitle_in_effect_at_the_snapshot_line", () => {
    const treeRoot = makeTempDir();
    const sessionId = SESSION_ONE;
    const projectDir = join(treeRoot, "projects", "-demo");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(treeRoot, "file-history"), { recursive: true });
    // Two titles bracketing two snapshots: v1 sits under the first title, v2 under the second.
    const records = [
        buildSessionCwdRecord(sessionId),
        { type: RecordType.customTitle, customTitle: "First title" },
        buildSnapshotRecord("blobV1", 1, "2026-06-03T10:00:00.000Z"),
        { type: RecordType.customTitle, customTitle: "Second title" },
        buildSnapshotRecord("blobV2", 2, "2026-06-03T11:00:00.000Z"),
    ];
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const blobDir = join(treeRoot, "file-history", sessionId);
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, "blobV1"), "one\n");
    writeFileSync(join(blobDir, "blobV2"), "two\n");
    const session = new Path(jsonlPath);

    const forVersion = (version: string): { content: string; title: string } => readSnapshotFileContent(
        new URLSearchParams({ snapshotSession: session.toString(), sessionId, version, path: RELATIVE_PATH, dir: CWD }),
    );
    assert.deepEqual(forVersion("1"), { content: "one\n", title: "First title" });
    assert.deepEqual(forVersion("2"), { content: "two\n", title: "Second title" });
});

test("test_snapshot_form_refuses_a_session_id_that_escapes_the_root", () => {
    const treeRoot = makeTempDir();
    const sessionOne = writeSession(treeRoot, SESSION_ONE, "2026-06-03T10:30:00.000Z");
    writeBlob(treeRoot, SESSION_ONE, "bytes A\n");
    const query = snapshotQuery(sessionOne, "../../etc");
    assert.throws(() => readSnapshotFileContent(query), /not a session id/);
});

test("test_snapshot_form_rejects_an_unknown_session_without_a_matching_placement", () => {
    // A well-shaped but unrecorded session id is a clean refusal, not a stack trace.
    const treeRoot = makeTempDir();
    const sessionOne = writeSession(treeRoot, SESSION_ONE, "2026-06-03T10:30:00.000Z");
    writeBlob(treeRoot, SESSION_ONE, "bytes A\n");
    const query = snapshotQuery(sessionOne, SESSION_TWO);
    assert.throws(() => readSnapshotFileContent(query), /no snapshot/);
});

test("test_isSnapshotFileRequest_only_fires_on_the_snapshot_marker", () => {
    assert.equal(isSnapshotFileRequest(new URLSearchParams({ dir: CWD, path: RELATIVE_PATH })), false);
    assert.equal(isSnapshotFileRequest(new URLSearchParams({ snapshotSession: "x.jsonl" })), true);
});
