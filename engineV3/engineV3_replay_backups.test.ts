import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { assertSnapshotBackupsMatchState, clearSeenBackups } from "./engineV3_replay_backups.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";

type TestFolders = { state: string; history: string; jsonl: string };

function makeTestFolders(t: TestContext): TestFolders {
  clearSeenBackups();
  const root = mkdtempSync(join(tmpdir(), "backups-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folders = { state: join(root, "state"), history: join(root, "history"), jsonl: join(root, "jsonl") };
  mkdirSync(folders.state);
  mkdirSync(join(folders.history, SESSION_ID), { recursive: true });
  mkdirSync(folders.jsonl);
  return folders;
}

function loadSnapshotLine(folders: TestFolders, trackedFileBackups: object): JSONLLine {
  const snapshot = { messageId: "m1", trackedFileBackups, timestamp: "2026-06-27T16:15:45.747Z" };
  const record = { type: "file-history-snapshot", messageId: "m1", snapshot, isSnapshotUpdate: false };
  writeFileSync(join(folders.jsonl, `${SESSION_ID}.jsonl`), JSON.stringify(record) + "\n");
  return loadMergedJSONLLines([folders.jsonl]).jsonlLines[0] as JSONLLine;
}

function createContext(folders: TestFolders | undefined): ScriptReplayContext {
  const fileHistoryPath = folders === undefined ? undefined : new Path(folders.history);
  return { bashCallResults: new Map(), writeEditResultLines: new Map(), sourceRepo: undefined, fileHistoryPath };
}

const NAMED_BACKUP = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: "2026-06-27T16:15:45.747Z" } };
const NULL_BACKUP = { "f.txt": { backupFileName: null, version: 1, backupTime: "2026-06-27T16:15:45.747Z" } };

test("test_assertSnapshotBackupsMatchState_passes_when_the_file_equals_the_named_backup", (t) => {
  // Step 1: the state file and the backup file hold the same bytes.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.state, "f.txt"), "line one\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "line one\n");
  // Step 2: the check returns the state and does not throw.
  const line = loadSnapshotLine(folders, NAMED_BACKUP);
  const state = new Path(folders.state);
  assert.equal(assertSnapshotBackupsMatchState(state, line, createContext(folders)), state);
});

test("test_assertSnapshotBackupsMatchState_resolves_the_key_against_realParentDir", (t) => {
  // Step 1: the file lives in state/sub, and the backup key "f.txt" names state/sub as its real parent folder.
  const folders = makeTestFolders(t);
  mkdirSync(join(folders.state, "sub"));
  writeFileSync(join(folders.state, "sub", "f.txt"), "line one\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "line one\n");
  const realParentBackup = { "f.txt": { ...NAMED_BACKUP["f.txt"], realParentDir: join(folders.state, "sub") } };
  // Step 2: the check finds state/sub/f.txt, equals its backup, and does not throw.
  const line = loadSnapshotLine(folders, realParentBackup);
  const state = new Path(folders.state);
  assert.equal(assertSnapshotBackupsMatchState(state, line, createContext(folders)), state);
});

test("test_assertSnapshotBackupsMatchState_throws_with_path_line_and_both_texts_when_bytes_differ", (t) => {
  // Step 1: the state file and the backup file hold different bytes.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.state, "f.txt"), "actual text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "backup text\n");
  const line = loadSnapshotLine(folders, NAMED_BACKUP);
  // Step 2: the error names the file, the JSONL line, the backup text and the replayed text.
  const check = () => assertSnapshotBackupsMatchState(new Path(folders.state), line, createContext(folders));
  assert.throws(check, /f\.txt[\s\S]*\.jsonl:1[\s\S]*backup text[\s\S]*actual text/);
});

test("test_assertSnapshotBackupsMatchState_throws_when_the_file_is_missing_but_a_backup_is_named", (t) => {
  // Step 1: the backup exists and the state file does not.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "line one\n");
  const line = loadSnapshotLine(folders, NAMED_BACKUP);
  // Step 2: the check throws and names the missing file.
  const check = () => assertSnapshotBackupsMatchState(new Path(folders.state), line, createContext(folders));
  assert.throws(check, /f\.txt[\s\S]*does not exist/);
});

test("test_assertSnapshotBackupsMatchState_passes_when_the_backup_is_null_and_the_file_is_absent", (t) => {
  // Step 1: the backup name is null and the state has no file.
  const folders = makeTestFolders(t);
  const line = loadSnapshotLine(folders, NULL_BACKUP);
  // Step 2: the check does not throw, and it needs no file-history folder.
  const state = new Path(folders.state);
  assert.equal(assertSnapshotBackupsMatchState(state, line, createContext(undefined)), state);
});

test("test_assertSnapshotBackupsMatchState_throws_when_the_backup_is_null_and_the_file_exists", (t) => {
  // Step 1: the backup name is null and the state has the file.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.state, "f.txt"), "should not be here\n");
  const line = loadSnapshotLine(folders, NULL_BACKUP);
  // Step 2: the check throws with the path and the replayed text.
  const check = () => assertSnapshotBackupsMatchState(new Path(folders.state), line, createContext(folders));
  assert.throws(check, /f\.txt[\s\S]*\.jsonl:1[\s\S]*should not be here/);
});

test("test_assertSnapshotBackupsMatchState_throws_when_a_backup_is_named_and_file_history_is_not_given", (t) => {
  // Step 1: a named backup and no file-history folder in the context.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.state, "f.txt"), "line one\n");
  const line = loadSnapshotLine(folders, NAMED_BACKUP);
  // Step 2: the check throws and names the flag.
  const check = () => assertSnapshotBackupsMatchState(new Path(folders.state), line, createContext(undefined));
  assert.throws(check, /--file-history/);
});

function loadTwoSnapshotLines(folders: TestFolders, firstBackups: object, secondBackups: object): JSONLLine[] {
  const rows: string[] = [];
  for (const trackedFileBackups of [firstBackups, secondBackups]) {
    const snapshot = { messageId: "m1", trackedFileBackups, timestamp: "2026-06-27T16:15:45.747Z" };
    rows.push(JSON.stringify({ type: "file-history-snapshot", messageId: "m1", snapshot, isSnapshotUpdate: true }));
  }
  writeFileSync(join(folders.jsonl, `${SESSION_ID}.jsonl`), rows.join("\n") + "\n");
  return loadMergedJSONLLines([folders.jsonl]).jsonlLines;
}

test("test_assertSnapshotBackupsMatchState_does_not_recheck_an_entry_repeated_unchanged_on_a_later_line", (t) => {
  // Step 1: line one has a null backup entry, line two repeats the same entry unchanged.
  const folders = makeTestFolders(t);
  const lines = loadTwoSnapshotLines(folders, NULL_BACKUP, NULL_BACKUP);
  const state = new Path(folders.state);
  // Step 2: the first line passes while the file is absent.
  assertSnapshotBackupsMatchState(state, lines[0] as JSONLLine, createContext(folders));
  // Step 3: the file is written between the two lines, as the Write at s1 line 48 does.
  writeFileSync(join(folders.state, "f.txt"), "written later\n");
  // Step 4: the second line does not throw, because the entry is not new or changed.
  assert.equal(assertSnapshotBackupsMatchState(state, lines[1] as JSONLLine, createContext(folders)), state);
});

test("test_assertSnapshotBackupsMatchState_rechecks_an_entry_whose_version_changed", (t) => {
  // Step 1: line one has a null backup at version 1, line two has a null backup at version 2.
  const folders = makeTestFolders(t);
  const changedBackup = { "f.txt": { backupFileName: null, version: 2, backupTime: "2026-06-27T16:15:45.747Z" } };
  const lines = loadTwoSnapshotLines(folders, NULL_BACKUP, changedBackup);
  const state = new Path(folders.state);
  assertSnapshotBackupsMatchState(state, lines[0] as JSONLLine, createContext(folders));
  writeFileSync(join(folders.state, "f.txt"), "written later\n");
  // Step 2: the second line is checked and throws, because the file exists.
  assert.throws(() => assertSnapshotBackupsMatchState(state, lines[1] as JSONLLine, createContext(folders)), /must not exist/);
});

test("test_applyJSONLLineToState_checks_the_backups_of_a_snapshot_line", (t) => {
  // Step 1: a snapshot line with a named backup that differs from the state file.
  const folders = makeTestFolders(t);
  writeFileSync(join(folders.state, "f.txt"), "actual text\n");
  writeFileSync(join(folders.history, SESSION_ID, "abc@v2"), "backup text\n");
  const line = loadSnapshotLine(folders, NAMED_BACKUP);
  // Step 2: applying the line throws the backup error, not the old "not supported yet" error.
  const apply = () => applyJSONLLineToState(new Path(folders.state), line, [], createContext(folders));
  assert.throws(apply, /differs from its backup/);
});
