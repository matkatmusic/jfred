// Task 355 step 5: events join to pairs by relative path and shape into the wire view; transcripts load from temp trees.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    LAYER1_PROGRESS_LABEL_READING_EDITS, LAYER1_PROGRESS_LABEL_REPLAYING_EDITS, buildEditsView, buildWireEdit, collectViewEditEventsByRelativePath, readBackupSeedLines,
} from "../src/layer1_edits_wire.ts";
import type { LayerEditEvent } from "../src/layer1_edit_events.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";
import {
    SESSION_A, SESSION_B, buildEditRecordPair, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture,
    type RecordEnvelope,
} from "./multi-source-test-helpers.ts";

const PROJECT_FOLDER = new Path("/work");
const HUNK = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-one", "+uno"] };

function buildEnvelope(sessionId: string, toolId: string, minute: number): RecordEnvelope {
    return { sessionId, cwd: "/work", timestamp: `2026-07-24T10:0${minute}:00.000Z`, toolId, parentUuid: null };
}

// Session A writes "one" then edits it; session B writes the same path later and writes one file outside /work.
function writeTwoSessions(): Path[] {
    const tree = makeSourceTree("-edits-wire");
    const writeA = buildWriteRecordPair(buildEnvelope(SESSION_A, "toolu_a1", 1), "/work/a.py", "one\n");
    const editA = buildEditRecordPair(buildEnvelope(SESSION_A, "toolu_a2", 2), "/work/a.py", "uno\n", "one\n", HUNK);
    const writeB = buildWriteRecordPair(buildEnvelope(SESSION_B, "toolu_b1", 3), "/work/a.py", "tres\n");
    const outside = buildWriteRecordPair(buildEnvelope(SESSION_B, "toolu_b2", 4), "/elsewhere/x.py", "x\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeA.records, ...editA.records]);
    writeTranscriptFixture(tree.projectDir, "b.jsonl", [...writeB.records, ...outside.records]);
    return [new Path(join(tree.projectDir, "b.jsonl")), new Path(join(tree.projectDir, "a.jsonl"))];
}

test("test_events_group_by_relative_path_across_sessions", () => {
    const byPath = collectViewEditEventsByRelativePath(PROJECT_FOLDER, writeTwoSessions());
    assert.deepEqual(byPath.get("a.py")!.map((event) => event.changeId.toString()), ["toolu_a1", "toolu_a2", "toolu_b1"]);
});

test("test_path_outside_project_folder_is_dropped", () => {
    const byPath = collectViewEditEventsByRelativePath(PROJECT_FOLDER, writeTwoSessions());
    assert.deepEqual([...byPath.keys()], ["a.py"]);
});

test("test_progress_line_per_session_file", () => {
    const lines: ProgressEvent[] = [];
    collectViewEditEventsByRelativePath(PROJECT_FOLDER, writeTwoSessions(), (event) => lines.push(event));
    assert.deepEqual(lines.map((line) => [line.label, line.current, line.total]), [
        [LAYER1_PROGRESS_LABEL_READING_EDITS, 1, 2], [LAYER1_PROGRESS_LABEL_READING_EDITS, 2, 2],
    ]);
});

test("test_the_view_build_counts_one_replay_progress_line_per_path_after_the_session_reads", () => {
    const lines: ProgressEvent[] = [];
    buildEditsView(PROJECT_FOLDER, writeTwoSessions(), (event) => lines.push(event));
    assert.deepEqual(lines.map((line) => [line.label, line.current, line.total]), [
        [LAYER1_PROGRESS_LABEL_READING_EDITS, 1, 2], [LAYER1_PROGRESS_LABEL_READING_EDITS, 2, 2],
        [LAYER1_PROGRESS_LABEL_REPLAYING_EDITS, 1, 1],
    ]);
});

test("test_wire_edit_has_no_axisPx_and_confidence_from_replay", () => {
    const [pair] = buildEditsView(PROJECT_FOLDER, writeTwoSessions()).pairs;
    assert.equal(pair!.path.toString(), "a.py");
    const [write, edit, otherSession] = pair!.edits;
    assert.deepEqual(Object.keys(edit!).sort(), ["changeId", "confidence", "instant", "kind", "line", "sessionFile", "sessionId"]);
    assert.equal(write!.confidence, WireConfidence.verified);
    assert.equal(edit!.kind, WireEditKind.edit);
    assert.equal(edit!.confidence, WireConfidence.verified);
    assert.equal(otherSession!.sessionId.toString(), SESSION_B);
});

test("test_absent_line_key_is_absent", () => {
    const event: LayerEditEvent = {
        changeId: new Uuid("t1"), kind: WireEditKind.read, target: new Path("/work/a.py"), instant: new Date(0),
        sessionId: new Uuid(SESSION_A), sessionFile: new Path("/work/a.jsonl"), line: undefined, content: "one\n",
    };
    const wire = buildWireEdit(event, { base: ["one"], target: ["one"], confidence: WireConfidence.verified });
    assert.equal("line" in wire, false);
});

test("test_seed_reader_returns_the_backup_lines_owned_by_the_session", () => {
    const tree = makeSourceTree("-edits-wire-seed-hit");
    const edit = buildEditRecordPair(buildEnvelope(SESSION_A, "toolu_a2", 2), "/work/a.py", "uno\n", "one\n", HUNK);
    const backupTime = "2026-07-24T10:00:30.000Z";
    const snapshot = { type: "file-history-snapshot", messageId: "m1", isSnapshotUpdate: false, snapshot: {
        messageId: "m1", timestamp: backupTime,
        trackedFileBackups: { "a.py": { backupFileName: "abc@v1", version: 1, backupTime } },
    } };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [snapshot, ...edit.records]);
    mkdirSync(join(tree.treeRoot, "file-history", SESSION_A), { recursive: true });
    writeFileSync(join(tree.treeRoot, "file-history", SESSION_A, "abc@v1"), "one\ntwo\n");
    const [event] = collectViewEditEventsByRelativePath(PROJECT_FOLDER, [new Path(join(tree.projectDir, "a.jsonl"))]).get("a.py")!;
    assert.deepEqual(readBackupSeedLines(event!), ["one", "two"]);
});

test("test_seed_is_undefined_when_session_backup_folder_is_missing", () => {
    const tree = makeSourceTree("-edits-wire-seed-no-folder");
    const edit = buildEditRecordPair(buildEnvelope(SESSION_A, "toolu_a2", 2), "/work/a.py", "uno\n", "one\n", HUNK);
    const backupTime = "2026-07-24T10:00:30.000Z";
    const snapshot = { type: "file-history-snapshot", messageId: "m1", isSnapshotUpdate: false, snapshot: {
        messageId: "m1", timestamp: backupTime,
        trackedFileBackups: { "a.py": { backupFileName: "abc@v1", version: 1, backupTime } },
    } };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [snapshot, ...edit.records]);
    const [event] = collectViewEditEventsByRelativePath(PROJECT_FOLDER, [new Path(join(tree.projectDir, "a.jsonl"))]).get("a.py")!;
    assert.equal(readBackupSeedLines(event!), undefined);
});

test("test_seed_reader_returns_undefined_when_the_session_has_no_backup", () => {
    const tree = makeSourceTree("-edits-wire-seed");
    const edit = buildEditRecordPair(buildEnvelope(SESSION_A, "toolu_a2", 2), "/work/a.py", "uno\n", "one\n", HUNK);
    writeTranscriptFixture(tree.projectDir, "a.jsonl", edit.records);
    const [event] = collectViewEditEventsByRelativePath(PROJECT_FOLDER, [new Path(join(tree.projectDir, "a.jsonl"))]).get("a.py")!;
    assert.equal(readBackupSeedLines(event!), undefined);
});
