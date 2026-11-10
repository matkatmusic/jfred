import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { clearSeenBackups } from "./engineV3_replay_backups.ts";
import { clearPendingWrites } from "./engineV3_replay_pending_writes.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const BACKUP_TIME = "2026-06-27T16:15:45.747Z";
const CALL_MESSAGE_ID = "call-message-1";

type TestFolders = { state: string; history: string; jsonl: string };

function makeTestFolders(t: TestContext): TestFolders {
  clearSeenBackups();
  clearPendingWrites();
  const root = mkdtempSync(join(tmpdir(), "hand-edits-"));
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

function makeWriteCallRow(filePath: string, content: string): object {
  const block = { type: "tool_use", id: "c1", name: "Write", input: { file_path: filePath, content } };
  return { type: "assistant", uuid: CALL_MESSAGE_ID, timestamp: makeTimestamp(1), message: { role: "assistant", content: [block] } };
}

function makeWriteResultRow(filePath: string, content: string, originalFile: string): object {
  const block = { type: "tool_result", tool_use_id: "c1", content: "ok" };
  const toolUseResult = { type: "update", filePath, content, structuredPatch: [], originalFile, userModified: false };
  return { type: "user", uuid: "result-1", parentUuid: CALL_MESSAGE_ID, timestamp: makeTimestamp(2), message: { role: "user", content: [block] }, toolUseResult };
}

function makeSnapshotRow(trackedFileBackups: object, messageId: string): object {
  const snapshot = { messageId: "inner-message", trackedFileBackups, timestamp: BACKUP_TIME };
  return { type: "file-history-snapshot", messageId, snapshot, isSnapshotUpdate: true };
}

function loadRows(folders: TestFolders, rows: object[]): JSONLLine[] {
  writeFileSync(join(folders.jsonl, `${SESSION_ID}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return loadMergedJSONLLines([folders.jsonl]).jsonlLines;
}

function createContext(folders: TestFolders, lines: JSONLLine[]): ScriptReplayContext {
  return { bashCallResults: new Map(), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(folders.history) };
}

function applyLinesInOrder(folders: TestFolders, lines: JSONLLine[]): void {
  const context = createContext(folders, lines);
  for (const line of lines) {
    applyJSONLLineToState(new Path(folders.state), line, [], context);
  }
}

test("test_applyJSONLLineToState_learns_a_hand_edit_for_a_snapshot_that_names_the_message_of_the_write_call", (t) => {
  // Step 1: the file holds the old text. The result originalFile and the backup hold the old text plus a user line.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "old text\n# user line\n");
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: BACKUP_TIME } };
  // Step 2: the snapshot line comes BEFORE the call line, and its messageId is the message of the call.
  const rows = [makeSnapshotRow(namedBackup, CALL_MESSAGE_ID), makeWriteCallRow(filePath, "new text\n"), makeWriteResultRow(filePath, "new text\n", "old text\n# user line\n")];
  const lines = loadRows(folders, rows);
  const context = createContext(folders, lines);
  const logLines: string[] = [];
  t.mock.method(console, "log", (text: string) => logLines.push(text));
  // Step 3: the snapshot line applies without a throw, and the file now holds the originalFile text.
  applyJSONLLineToState(new Path(folders.state), lines[0] as JSONLLine, [], context);
  assert.equal(readFileSync(filePath, "utf8"), "old text\n# user line\n");
  // Step 4: one printed line names the file and the JSONL line that taught the hand edit.
  assert.equal(logLines.length, 1);
  assert.match(logLines[0] as string, /hand edit[\s\S]*f\.txt[\s\S]*\.jsonl:3/);
});

test("test_applyJSONLLineToState_throws_when_the_backup_differs_from_the_originalFile_learned_for_a_snapshot", (t) => {
  // Step 1: the originalFile holds a user line, and the backup holds other text.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "other text\n");
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: BACKUP_TIME } };
  const rows = [makeSnapshotRow(namedBackup, CALL_MESSAGE_ID), makeWriteCallRow(filePath, "new text\n"), makeWriteResultRow(filePath, "new text\n", "old text\n# user line\n")];
  const lines = loadRows(folders, rows);
  t.mock.method(console, "log", () => undefined);
  // Step 2: the snapshot line throws, and the backup is not copied into the file.
  assert.throws(() => applyLinesInOrder(folders, lines), /differs from its backup/);
  assert.equal(readFileSync(filePath, "utf8"), "old text\n# user line\n");
});

test("test_applyJSONLLineToState_learns_a_hand_edit_at_the_call_line", (t) => {
  // Step 1: the file holds the old text, and the result originalFile holds the old text plus a user line.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  const rows = [makeWriteCallRow(filePath, "new text\n"), makeWriteResultRow(filePath, "new text\n", "old text\n# user line\n")];
  const lines = loadRows(folders, rows);
  const logLines: string[] = [];
  t.mock.method(console, "log", (text: string) => logLines.push(text));
  // Step 2: the call line prints one hand-edit line that names the file and the result JSONL line.
  applyJSONLLineToState(new Path(folders.state), lines[0] as JSONLLine, [], createContext(folders, lines));
  assert.equal(logLines.length, 1);
  assert.match(logLines[0] as string, /hand edit[\s\S]*f\.txt[\s\S]*\.jsonl:2/);
});

test("test_applyJSONLLineToState_prints_nothing_when_the_originalFile_equals_the_file", (t) => {
  // Step 1: the file and the result originalFile hold the same text.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  const rows = [makeWriteCallRow(filePath, "new text\n"), makeWriteResultRow(filePath, "new text\n", "old text\n")];
  const lines = loadRows(folders, rows);
  const logLines: string[] = [];
  t.mock.method(console, "log", (text: string) => logLines.push(text));
  // Step 2: no hand edit is learned, so nothing prints.
  applyJSONLLineToState(new Path(folders.state), lines[0] as JSONLLine, [], createContext(folders, lines));
  assert.equal(logLines.length, 0);
});

test("test_applyJSONLLineToState_does_not_learn_for_a_snapshot_after_the_call_applied_early", (t) => {
  // Step 1: the call line applies early, then a snapshot that names the same message sits before the result line.
  const folders = makeTestFolders(t);
  const filePath = join(folders.state, "f.txt");
  writeFileSync(filePath, "old text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "old text\n");
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: BACKUP_TIME } };
  const rows = [makeWriteCallRow(filePath, "new text\n"), makeSnapshotRow(namedBackup, CALL_MESSAGE_ID), makeWriteResultRow(filePath, "new text\n", "old text\n")];
  const lines = loadRows(folders, rows);
  // Step 2: the snapshot does not write the originalFile over the applied write.
  applyLinesInOrder(folders, lines);
  assert.equal(readFileSync(filePath, "utf8"), "new text\n");
});
