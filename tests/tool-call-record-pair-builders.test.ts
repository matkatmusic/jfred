import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEditRecordPair,
  buildErroredToolResultRecordPair,
  buildReadRecordPair,
  buildWriteRecordPair,
  type RecordEnvelope,
} from "./tool-call-record-pair-builders.ts";

const ENVELOPE: RecordEnvelope = {
  sessionId: "session-1",
  cwd: "/work",
  timestamp: "2026-07-22T10:00:00.000Z",
  toolId: "toolu_1",
  parentUuid: null,
};

test("buildWriteRecordPair builds a tool_use and a create result", () => {
  const pair = buildWriteRecordPair(ENVELOPE, "/work/a.txt", "hello");
  assert.equal(pair.lastUuid, "toolu_1-result");
  assert.equal(pair.records.length, 2);
  const assistant = pair.records[0] as Record<string, any>;
  const user = pair.records[1] as Record<string, any>;
  assert.equal(assistant.uuid, "toolu_1-assistant");
  assert.equal(assistant.message.content[0].name, "Write");
  assert.deepEqual(assistant.message.content[0].input, { file_path: "/work/a.txt", content: "hello" });
  assert.equal(user.parentUuid, "toolu_1-assistant");
  assert.equal(user.toolUseResult.type, "create");
  assert.equal(user.toolUseResult.content, "hello");
});

test("buildEditRecordPair carries the hunk and the original file", () => {
  const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" a", "+b"] };
  const pair = buildEditRecordPair(ENVELOPE, "/work/a.txt", "a\nb\n", "a\n", hunk);
  const assistant = pair.records[0] as Record<string, any>;
  const user = pair.records[1] as Record<string, any>;
  assert.equal(assistant.message.content[0].name, "Edit");
  assert.equal(user.toolUseResult.type, "update");
  assert.deepEqual(user.toolUseResult.structuredPatch, [hunk]);
  assert.equal(user.toolUseResult.originalFile, "a\n");
});

test("buildReadRecordPair carries the echo window", () => {
  const pair = buildReadRecordPair(ENVELOPE, "/work/a.txt", "x", { startLine: 2, numLines: 1, totalLines: 5 });
  const assistant = pair.records[0] as Record<string, any>;
  const user = pair.records[1] as Record<string, any>;
  assert.equal(assistant.message.content[0].name, "Read");
  assert.deepEqual(user.toolUseResult.file, { filePath: "/work/a.txt", content: "x", numLines: 1, startLine: 2, totalLines: 5 });
});

test("buildErroredToolResultRecordPair reports a plain string result", () => {
  const pair = buildErroredToolResultRecordPair(ENVELOPE, "Read", { file_path: "/work/a.txt" }, "Error: File does not exist.");
  const assistant = pair.records[0] as Record<string, any>;
  const user = pair.records[1] as Record<string, any>;
  assert.equal(assistant.message.content[0].name, "Read");
  assert.equal(user.toolUseResult, "Error: File does not exist.");
  assert.equal(user.message.content[0].content, "Error: File does not exist.");
});
