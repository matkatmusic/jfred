// Task 355 step 2: one session transcript becomes Edit/Write/Read events that carry the wire identity.

import assert from "node:assert/strict";
import { test } from "node:test";
import { statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { compareEditEvents, readSessionEditEvents, type LayerEditEvent } from "../src/layer1_edit_events.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { WireEditKind } from "../webapp/layer1-wire-edits.ts";
import {
    SESSION_A, buildEditRecordPair, buildReadRecordPair, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture,
    type RecordEnvelope,
} from "./multi-source-test-helpers.ts";

const FILE_PATH = "/work/a.py";
const HUNK = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-one", "+uno"] };

function buildEnvelope(toolId: string, minute: number): RecordEnvelope {
    const timestamp = `2026-07-24T10:0${minute}:00.000Z`;
    return { sessionId: SESSION_A, cwd: "/work", timestamp, toolId, parentUuid: null };
}

function loadEventsFrom(records: object[]): LayerEditEvent[] {
    const tree = makeSourceTree("-events-project");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", records);
    return readSessionEditEvents(new Path(join(tree.projectDir, "a.jsonl")));
}

test("test_edit_event_carries_hunks_and_result_record_line", () => {
    const edit = buildEditRecordPair(buildEnvelope("toolu_e1", 1), FILE_PATH, "uno\n", "one\n", HUNK);
    const [event] = loadEventsFrom(edit.records);
    assert.equal(event!.kind, WireEditKind.edit);
    assert.equal(event!.changeId.toString(), "toolu_e1");
    assert.equal(event!.target.toString(), FILE_PATH);
    assert.equal(event!.sessionId.toString(), SESSION_A);
    assert.deepEqual(event!.hunks, [HUNK]);
    assert.equal(event!.line, 2);
});

test("test_write_event_carries_full_content", () => {
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 1), FILE_PATH, "body\n");
    const [event] = loadEventsFrom(write.records);
    assert.equal(event!.kind, WireEditKind.write);
    assert.equal(event!.content, "body\n");
});

test("test_complete_read_echo_becomes_read_event_with_tool_use_id", () => {
    const read = buildReadRecordPair(buildEnvelope("toolu_r1", 1), FILE_PATH, "one\n", { startLine: 1, numLines: 1, totalLines: 1 });
    const [event] = loadEventsFrom(read.records);
    assert.equal(event!.kind, WireEditKind.read);
    assert.equal(event!.changeId.toString(), "toolu_r1");
    assert.equal(event!.content, "one\n");
    assert.equal(event!.line, 2);
});

test("test_partial_read_window_makes_no_event", () => {
    const read = buildReadRecordPair(buildEnvelope("toolu_r1", 1), FILE_PATH, "one\n", { startLine: 1, numLines: 1, totalLines: 3 });
    assert.deepEqual(loadEventsFrom(read.records), []);
});

test("test_edit_without_structured_patch_makes_no_event", () => {
    const edit = buildEditRecordPair(buildEnvelope("toolu_e1", 1), FILE_PATH, "uno\n", "one\n", HUNK);
    const [assistant, result] = edit.records as Record<string, unknown>[];
    const bareResult = { ...result, toolUseResult: { type: "update", filePath: FILE_PATH } };
    assert.deepEqual(loadEventsFrom([assistant!, bareResult]), []);
});

test("test_bash_cat_becomes_read_event", () => {
    const toolId = "toolu_cat_1";
    const envelope = { sessionId: SESSION_A, cwd: "/work", timestamp: "2026-07-24T10:01:00.000Z" };
    const records = [
        { ...envelope, type: "assistant", uuid: "a1", parentUuid: null,
            message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Bash", input: { command: "cat a.py" } }] } },
        { ...envelope, type: "user", uuid: "r1", parentUuid: "a1",
            message: { role: "user", content: [{ tool_use_id: toolId, type: "tool_result", content: "one\n" }] },
            toolUseResult: { stdout: "one\n", stderr: "", interrupted: false, isImage: false, noOutputExpected: false } },
    ];
    const [event] = loadEventsFrom(records);
    assert.equal(event!.kind, WireEditKind.read);
    assert.equal(event!.target.toString(), FILE_PATH);
    assert.equal(event!.line, 2);
});

test("test_events_sort_by_instant_then_line", () => {
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 2), FILE_PATH, "body\n");
    const read = buildReadRecordPair(buildEnvelope("toolu_r1", 1), FILE_PATH, "one\n", { startLine: 1, numLines: 1, totalLines: 1 });
    const events = loadEventsFrom([...write.records, ...read.records]);
    assert.deepEqual(events.map((event) => event.kind), [WireEditKind.read, WireEditKind.write]);
    const [first] = events;
    const sameInstantLaterLine: LayerEditEvent = { ...first!, changeId: new Uuid("x"), line: 9 };
    assert.ok(compareEditEvents(first!, sameInstantLaterLine) < 0);
});

test("test_session_events_are_cached_until_file_mtime_changes", () => {
    const tree = makeSourceTree("-events-project");
    const sessionFile = join(tree.projectDir, "a.jsonl");
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 1), FILE_PATH, "body\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", write.records);
    const first = readSessionEditEvents(new Path(sessionFile));
    assert.equal(readSessionEditEvents(new Path(sessionFile)), first);
    const later = new Date(statSync(sessionFile).mtimeMs + 5000);
    const rewritten = buildWriteRecordPair(buildEnvelope("toolu_w2", 2), FILE_PATH, "new body\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", rewritten.records);
    utimesSync(sessionFile, later, later);
    assert.equal(readSessionEditEvents(new Path(sessionFile))[0]!.content, "new body\n");
});
