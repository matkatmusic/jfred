import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { clearSeenBackups } from "./engineV3_replay_backups.ts";
import { ABSENT_BEFORE_CONTENT, clearPendingWrites, removePendingWrite, findPendingBeforeContent, addPendingWrite } from "./engineV3_replay_pending_writes.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const BACKUP_TIME = "2026-06-27T16:15:45.747Z";

type TestFolders = { state: string; history: string; jsonl: string };

function makeTestFolders(t: TestContext): TestFolders {
  clearSeenBackups();
  clearPendingWrites();
  const root = mkdtempSync(join(tmpdir(), "pending-writes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folders = { state: join(root, "state"), history: join(root, "history"), jsonl: join(root, "jsonl") };
  mkdirSync(folders.state);
  mkdirSync(join(folders.history, SESSION_ID), { recursive: true });
  mkdirSync(folders.jsonl);
  return folders;
}

function makeTimestamp(secondsPastMidnight: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
}

function makeWriteCallRow(callId: string, filePath: string, content: string, second: number): object {
  const block = { type: "tool_use", id: callId, name: "Write", input: { file_path: filePath, content } };
  return { type: "assistant", uuid: `call-${callId}`, timestamp: makeTimestamp(second), message: { role: "assistant", content: [block] } };
}

function makeWriteResultRow(callId: string, toolUseResult: object, second: number): object {
  const block = { type: "tool_result", tool_use_id: callId, content: "ok" };
  return { type: "user", uuid: `result-${callId}`, timestamp: makeTimestamp(second), message: { role: "user", content: [block] }, toolUseResult };
}

function makeSnapshotRow(trackedFileBackups: object, messageId: string): object {
  const snapshot = { messageId, trackedFileBackups, timestamp: BACKUP_TIME };
  return { type: "file-history-snapshot", messageId, snapshot, isSnapshotUpdate: true };
}

function loadRows(folders: TestFolders, rows: object[]): JSONLLine[] {
  writeFileSync(join(folders.jsonl, `${SESSION_ID}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return loadMergedJSONLLines([folders.jsonl]).jsonlLines;
}

function createContext(folders: TestFolders, lines: JSONLLine[]): ScriptReplayContext {
  return { bashCallResults: new Map(), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(folders.history) };
}

function applyAllLines(folders: TestFolders, lines: JSONLLine[]): void {
  const context = createContext(folders, lines);
  for (const line of lines) {
    applyJSONLLineToState(new Path(folders.state), line, [], context);
  }
}

test("test_applyJSONLLineToState_accepts_a_null_backup_between_a_write_call_and_its_result", (t) => {
  // Step 1: the file is absent. The call line, a snapshot with a null backup, and the result line follow in order.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  const createResult = { type: "create", filePath, content: "new text\n", structuredPatch: [], originalFile: null, userModified: false };
  const nullBackup = { "f.txt": { backupFileName: null, version: 1, backupTime: BACKUP_TIME } };
  const lines = loadRows(folders, [makeWriteCallRow("c1", filePath, "new text\n", 1), makeSnapshotRow(nullBackup, "m1"), makeWriteResultRow("c1", createResult, 3)]);
  // Step 2: all three lines apply without a throw, and the file holds the written text.
  applyAllLines(folders, lines);
  assert.equal(readFileSync(filePath, "utf8"), "new text\n");
});

test("test_applyJSONLLineToState_compares_a_named_backup_with_the_content_from_before_the_write", (t) => {
  // Step 1: the file holds the old text, and the backup holds the same old text.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "old text\n");
  // Step 2: the call line writes the new text early. The snapshot between the call and the result names the backup.
  const updateResult = { type: "update", filePath, content: "new text\n", structuredPatch: [], originalFile: "old text\n", userModified: false };
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: BACKUP_TIME } };
  const lines = loadRows(folders, [makeWriteCallRow("c1", filePath, "new text\n", 1), makeSnapshotRow(namedBackup, "m1"), makeWriteResultRow("c1", updateResult, 3)]);
  // Step 3: all three lines apply without a throw.
  applyAllLines(folders, lines);
  assert.equal(readFileSync(filePath, "utf8"), "new text\n");
});

test("test_applyJSONLLineToState_throws_when_a_named_backup_differs_from_the_content_from_before_the_write", (t) => {
  // Step 1: the file holds the old text, and the backup holds other text.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "other text\n");
  const updateResult = { type: "update", filePath, content: "new text\n", structuredPatch: [], originalFile: "old text\n", userModified: false };
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: BACKUP_TIME } };
  const lines = loadRows(folders, [makeWriteCallRow("c1", filePath, "new text\n", 1), makeSnapshotRow(namedBackup, "m1"), makeWriteResultRow("c1", updateResult, 3)]);
  // Step 2: the snapshot line throws, and the error shows the old text as the replayed text.
  assert.throws(() => applyAllLines(folders, lines), /differs from its backup[\s\S]*old text/);
});

test("test_applyJSONLLineToState_checks_the_disk_again_after_the_result_line", (t) => {
  // Step 1: a write call and its result apply, then a snapshot with a null backup of a new version follows.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  const createResult = { type: "create", filePath, content: "new text\n", structuredPatch: [], originalFile: null, userModified: false };
  const nullBackup = { "f.txt": { backupFileName: null, version: 1, backupTime: BACKUP_TIME } };
  const laterNullBackup = { "f.txt": { backupFileName: null, version: 2, backupTime: BACKUP_TIME } };
  const rows = [makeWriteCallRow("c1", filePath, "new text\n", 1), makeSnapshotRow(nullBackup, "m1"), makeWriteResultRow("c1", createResult, 3), makeSnapshotRow(laterNullBackup, "m2")];
  const lines = loadRows(folders, rows);
  // Step 2: the last snapshot compares with the disk, where the file exists, so it throws.
  assert.throws(() => applyAllLines(folders, lines), /must not exist/);
});

test("test_addPendingWrite_keeps_the_first_before_content_until_the_last_result_arrives", (t) => {
  // Step 1: the file holds text A. Two write calls to the file are recorded, and the file changes between them.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "text A");
  const createResult = { type: "create", filePath, content: "text B", structuredPatch: [], originalFile: null, userModified: false };
  const lines = loadRows(folders, [makeWriteResultRow("c1", createResult, 1)]);
  const state = new Path(folders.state);
  addPendingWrite(state, lines[0] as JSONLLine);
  writeFileSync(filePath, "text B");
  addPendingWrite(state, lines[0] as JSONLLine);
  // Step 2: the record holds text A while one result is still pending.
  removePendingWrite(state, lines[0] as JSONLLine);
  assert.deepEqual(findPendingBeforeContent(filePath), Buffer.from("text A"));
  // Step 3: the last result drops the record.
  removePendingWrite(state, lines[0] as JSONLLine);
  assert.equal(findPendingBeforeContent(filePath), undefined);
});

test("test_addPendingWrite_records_absent_for_a_file_that_does_not_exist", (t) => {
  // Step 1: the file is absent when the write call is recorded.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  const createResult = { type: "create", filePath, content: "text B", structuredPatch: [], originalFile: null, userModified: false };
  const lines = loadRows(folders, [makeWriteResultRow("c1", createResult, 1)]);
  addPendingWrite(new Path(folders.state), lines[0] as JSONLLine);
  // Step 2: the record says absent.
  assert.equal(findPendingBeforeContent(filePath), ABSENT_BEFORE_CONTENT);
});
