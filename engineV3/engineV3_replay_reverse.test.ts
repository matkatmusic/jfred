import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Path, Uuid } from "../src/structures/domain.ts";
import { readReverseSettingsFromArguments } from "./engineV3_replay_settings.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { ReverseStateKind, collectBackupKnownStates, collectGitKnownStates, formatReverseStateLine, walkFileBackwards, walkFileBackwardsWithKnownStates, type KnownFileState, type ReverseFileState } from "./engineV3_replay_reverse.ts";

type EditChange = { oldString: string; newString: string; originalFile?: string | null; replaceAll?: boolean };

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-reverse-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number, offsetMilliseconds: number = 0): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000 + offsetMilliseconds);
}

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: makeInstant(second, -1).toISOString(), message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, toolUseResult: unknown, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content }, toolUseResult };
}

function makeEditRows(toolUseId: string, filePath: string, change: EditChange, second: number): object[] {
    const toolUseResult: Record<string, unknown> = { filePath, oldString: change.oldString, newString: change.newString, replaceAll: change.replaceAll ?? false, structuredPatch: [], userModified: false };
    if (change.originalFile !== undefined) {
        toolUseResult.originalFile = change.originalFile;
    }
    return [makeCallRecord("Edit", toolUseId, { file_path: filePath }, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeWriteRows(toolUseId: string, filePath: string, type: "create" | "update", content: string, originalFile: string | null, second: number): object[] {
    const toolUseResult = { type, filePath, content, originalFile, structuredPatch: [], userModified: false };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath }, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeBashRows(toolUseId: string, command: string, second: number): object[] {
    return [makeCallRecord("Bash", toolUseId, { command }, second)];
}

function writeRecords(jsonlFolder: string, fileName: string, records: object[]): void {
    const filePath = join(jsonlFolder, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

// The target file lives in its own folder; undefined disk text means the file does not exist.
function makeTargetFile(t: TestContext, diskText: string | undefined): Path {
    const filePath = join(makeTempFolder(t), "a.txt");
    if (diskText !== undefined) {
        writeFileSync(filePath, diskText);
    }
    return new Path(filePath);
}

function summarizeStates(states: ReverseFileState[]): string[] {
    return states.map((state) => `${state.kind}:${state.content}`);
}

type BackupEntry = { backupFileName: string | null; backupTime: Date; realParentDir?: string };
type ClaudeHome = { jsonlsFolder: string; fileHistoryFolder: string };

// The jsonls folder sits two levels below the Claude home, like ~/.claude/projects/<project>; file-history is beside projects.
function makeClaudeHome(t: TestContext): ClaudeHome {
    const claudeHome = makeTempFolder(t);
    const jsonlsFolder = join(claudeHome, "projects", "p");
    const fileHistoryFolder = join(claudeHome, "file-history");
    mkdirSync(jsonlsFolder, { recursive: true });
    mkdirSync(fileHistoryFolder);
    return { jsonlsFolder, fileHistoryFolder };
}

function writeBackupFile(fileHistoryFolder: string, sessionId: string, backupFileName: string, content: string): void {
    mkdirSync(join(fileHistoryFolder, sessionId), { recursive: true });
    writeFileSync(join(fileHistoryFolder, sessionId, backupFileName), content);
}

function makeSnapshotRecord(messageId: string, trackedFileBackups: Record<string, BackupEntry>): object {
    const wireBackups: Record<string, object> = {};
    for (const [key, entry] of Object.entries(trackedFileBackups)) {
        wireBackups[key] = { backupFileName: entry.backupFileName, version: 1, backupTime: entry.backupTime.toISOString(), ...(entry.realParentDir === undefined ? {} : { realParentDir: entry.realParentDir }) };
    }
    return { type: "file-history-snapshot", messageId, snapshot: { messageId, trackedFileBackups: wireBackups, timestamp: makeInstant(0).toISOString() }, isSnapshotUpdate: false };
}

function collectBackupStatesFromFolder(file: Path, jsonlsFolder: string): KnownFileState[] {
    const jsonlLines = loadMergedJSONLLines([jsonlsFolder]).jsonlLines;
    return collectBackupKnownStates(file, jsonlLines, [new Path(join(jsonlsFolder, "..", "..", "file-history"))]);
}

function makeCwdRecord(cwd: string, second: number): object {
    return { ...makeResultRecord("toolu_cwd", "ok", second), cwd };
}

function runGit(folder: string, args: string[], second: number): void {
    const commitDate = makeInstant(second).toISOString();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, stdio: "pipe" });
}

function initGitRepo(folder: string): void {
    runGit(folder, ["init", "-q"], 0);
}

function commitFileText(file: Path, text: string, second: number): void {
    writeFileSync(file.toString(), text);
    runGit(dirname(file.toString()), ["add", "a.txt"], second);
    runGit(dirname(file.toString()), ["commit", "-q", "-m", `commit at ${second}`], second);
}

function makeGitTargetFile(t: TestContext): Path {
    const file = makeTargetFile(t, undefined);
    initGitRepo(dirname(file.toString()));
    return file;
}

function readHeadCommitHash(file: Path): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dirname(file.toString()), encoding: "utf8" }).trim();
}

const FAKE_COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";

function makeKnownBackupState(second: number, content: string): KnownFileState {
    return { timestamp: makeInstant(second), content, commitHash: undefined, source: undefined };
}

function makeKnownCommitState(second: number, content: string, commitHash: string = FAKE_COMMIT_HASH): KnownFileState {
    return { timestamp: makeInstant(second), content, commitHash: new Uuid(commitHash), source: undefined };
}

test("test_walkFileBackwards_returns_only_DiskNow_when_no_row_changed_the_file", (t) => {
    // Scenario: a file with no Write/Edit rows has one state.
    const file = makeTargetFile(t, "hello");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", "/other/b.txt", "create", "x", null, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // only the disk state is returned, with index 0 and no timestamp
    assert.equal(states.length, 1);
    assert.deepEqual(states[0], { index: 0, kind: ReverseStateKind.DiskNow, timestamp: undefined, content: "hello", jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true });
});

test("test_walkFileBackwards_reports_undefined_content_when_the_file_is_absent_on_disk", (t) => {
    // Scenario: the file does not exist on disk.
    const file = makeTargetFile(t, undefined);
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the disk state has undefined content
    assert.deepEqual(summarizeStates(states), ["DiskNow:undefined"]);
});

test("test_walkFileBackwards_undoes_an_Edit_without_originalFile_by_swapping_newString_back", (t) => {
    // Scenario: an Edit row has no originalFile, so the walk swaps newString back to oldString.
    const file = makeTargetFile(t, "one B three");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the second state is the text before the edit
    assert.deepEqual(summarizeStates(states), ["DiskNow:one B three", "EditUndone:one A three"]);
});

test("test_walkFileBackwards_undoes_an_Edit_with_originalFile_to_the_originalFile", (t) => {
    // Scenario: an Edit row with originalFile gives the earlier text directly.
    const file = makeTargetFile(t, "one B three");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B", originalFile: "one A three" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the second state is the originalFile
    assert.deepEqual(summarizeStates(states), ["DiskNow:one B three", "EditUndone:one A three"]);
});

test("test_walkFileBackwards_applies_replaceAll_to_originalFile_before_the_check", (t) => {
    // Scenario: a replaceAll Edit changed every occurrence, so the disk text must match all of them replaced.
    const file = makeTargetFile(t, "b-b-b");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "a", newString: "b", originalFile: "a-a-a", replaceAll: true }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the check passes and the edit is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:b-b-b", "EditUndone:a-a-a"]);
});

test("test_walkFileBackwards_applies_only_the_first_match_when_replaceAll_is_false", (t) => {
    // Scenario: a single Edit changed only the first occurrence.
    const file = makeTargetFile(t, "b-a-a");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "a", newString: "b", originalFile: "a-a-a" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the check passes and the edit is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:b-a-a", "EditUndone:a-a-a"]);
});

test("test_walkFileBackwards_undoes_a_Write_update_to_its_originalFile", (t) => {
    // Scenario: a Write-update row gives the earlier text as originalFile.
    const file = makeTargetFile(t, "new");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "new", "old", 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the second state is WriteUndone with the old text
    assert.deepEqual(summarizeStates(states), ["DiskNow:new", "WriteUndone:old"]);
});

test("test_walkFileBackwards_undoes_a_Write_create_to_an_absent_file", (t) => {
    // Scenario: a Write-create row means the file did not exist before it.
    const file = makeTargetFile(t, "new");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "create", "new", null, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the second state is FileCreated with undefined content
    assert.deepEqual(summarizeStates(states), ["DiskNow:new", "FileCreated:undefined"]);
});

test("test_walkFileBackwards_lists_states_newest_first_with_rising_index_and_falling_timestamp", (t) => {
    // Scenario: two Edit rows give three states ordered newest to oldest.
    const file = makeTargetFile(t, "C");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1), ...makeEditRows("toolu_B", file.toString(), { oldString: "B", newString: "C" }, 3)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // contents run C, B, A
    assert.deepEqual(summarizeStates(states), ["DiskNow:C", "EditUndone:B", "EditUndone:A"]);
    // indexes rise from 0
    assert.deepEqual(states.map((state) => state.index), [0, 1, 2]);
    // timestamps are the undone rows' instants
    assert.deepEqual(states.map((state) => state.timestamp), [undefined, makeInstant(3), makeInstant(1)]);
});

test("test_walkFileBackwards_orders_rows_by_timestamp_not_by_file_order", (t) => {
    // Scenario: the newer row sits first in the file, the older row second.
    const file = makeTargetFile(t, "C");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeEditRows("toolu_B", file.toString(), { oldString: "B", newString: "C" }, 3), ...makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk still goes C, B, A
    assert.deepEqual(summarizeStates(states), ["DiskNow:C", "EditUndone:B", "EditUndone:A"]);
});

test("test_walkFileBackwards_records_the_source_line_of_the_undone_row", (t) => {
    // Scenario: each undone state points at the JSONL file and line of its result row.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the result row is line 2 of s1.jsonl
    assert.equal(states[1]!.jsonlPath!.toString(), join(jsonlFolder, "s1.jsonl"));
    assert.equal(states[1]!.lineNumber, 2);
});

test("test_walkFileBackwards_ignores_rows_of_other_files", (t) => {
    // Scenario: an Edit of another file does not affect this file's walk.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", "/other/b.txt", { oldString: "X", newString: "Y" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // only the disk state is returned
    assert.deepEqual(summarizeStates(states), ["DiskNow:B"]);
});

test("test_walkFileBackwards_ignores_a_rejected_edit_whose_result_is_text", (t) => {
    // Scenario: a rejected Edit has a text toolUseResult and changed nothing.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [makeCallRecord("Edit", "toolu_A", {}, 1), makeResultRecord("toolu_A", "User rejected tool use", 1)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // only the disk state is returned
    assert.deepEqual(summarizeStates(states), ["DiskNow:B"]);
});

test("test_walkFileBackwards_reads_rows_from_helper_files_in_sub_folders", (t) => {
    // Scenario: an agent-*.jsonl file in a sub-folder holds a row that changed the file.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    writeRecords(jsonlFolder, "s1/subagents/agent-x.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the helper row is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:B", "EditUndone:A"]);
});

test("test_walkFileBackwards_does_not_treat_dollar_signs_in_oldString_as_replacement_patterns", (t) => {
    // Scenario: the swap-back must insert oldString literally even when it holds "$&".
    const file = makeTargetFile(t, "x Q y");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "$&", newString: "Q" }, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the earlier text holds the literal "$&"
    assert.equal(states[1]!.content, "x $& y");
});

test("test_walkFileBackwards_makes_an_UnknownChange_gap_when_disk_differs_from_the_write_content", (t) => {
    // Scenario: the disk text is not what the newest Write produced, so something changed the file after it.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // a gap state holds the Write content, then the Write is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:X", "UnknownChange:B", "WriteUndone:A"]);
});

test("test_walkFileBackwards_stamps_the_gap_state_with_the_instant_of_the_known_text", (t) => {
    // Scenario: the gap state's timestamp is the instant of the text it holds.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the gap state carries the Write row's instant
    assert.deepEqual(states[1]!.timestamp, makeInstant(1));
});

test("test_walkFileBackwards_marks_a_gap_ScriptChange_when_a_Bash_call_names_the_file_inside_the_window", (t) => {
    // Scenario: a Bash call that names a.txt ran between the Write and now.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1), ...makeBashRows("toolu_B", "sed -i s/B/X/ ./a.txt", 2)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the gap is a ScriptChange
    assert.equal(states[1]!.kind, ReverseStateKind.ScriptChange);
});

test("test_walkFileBackwards_keeps_UnknownChange_when_the_Bash_call_names_a_longer_file_name", (t) => {
    // Scenario: "xa.txt" contains "a.txt" but is another file, so the boundary check rejects it.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1), ...makeBashRows("toolu_B", "rm xa.txt", 2)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the gap stays UnknownChange
    assert.equal(states[1]!.kind, ReverseStateKind.UnknownChange);
});

test("test_walkFileBackwards_keeps_UnknownChange_when_the_Bash_call_ran_before_the_known_text", (t) => {
    // Scenario: a Bash call that names a.txt ran before the Write, outside the gap window.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeBashRows("toolu_B", "cat a.txt", 0), ...makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the gap stays UnknownChange
    assert.equal(states[1]!.kind, ReverseStateKind.UnknownChange);
});

test("test_walkFileBackwards_stops_when_an_Edit_without_originalFile_fails_and_no_known_text_exists", (t) => {
    // Scenario: newString is not in the disk text and nothing older is known.
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk stops at the disk state
    assert.deepEqual(summarizeStates(states), ["DiskNow:Z"]);
});

test("test_walkFileBackwards_stops_when_newString_occurs_twice_in_the_disk_text", (t) => {
    // Scenario: with newString in two places the edit position is unknown.
    const file = makeTargetFile(t, "B B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk stops at the disk state
    assert.deepEqual(summarizeStates(states), ["DiskNow:B B"]);
});

test("test_walkFileBackwards_stops_when_a_replaceAll_Edit_has_no_originalFile", (t) => {
    // Scenario: a replaceAll Edit without originalFile cannot be reversed.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B", replaceAll: true }, 5));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk stops at the disk state
    assert.deepEqual(summarizeStates(states), ["DiskNow:B"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_uses_an_extra_known_state_older_than_the_failed_row", (t) => {
    // Scenario: the Edit fails its check and an extra known text exists from before the Edit.
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards with one extra known state at second 3
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(3, "M")]);
    // a gap state holds the extra text, then the extra state itself appears once
    assert.deepEqual(summarizeStates(states), ["DiskNow:Z", "UnknownChange:M", "BackupSnapshot:M"]);
    assert.deepEqual(states[1]!.timestamp, makeInstant(3));
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_does_not_use_an_extra_known_state_newer_than_the_failed_row_to_pass_the_row", (t) => {
    // Scenario: an extra known text from after the failed Edit cannot stand in for the state before it.
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards with one extra known state at second 9
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(9, "M")]);
    // the extra state is listed, and the walk stops there
    assert.deepEqual(summarizeStates(states), ["DiskNow:Z", "UnknownChange:M", "BackupSnapshot:M"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_continues_with_the_first_row_older_than_the_extra_known_state", (t) => {
    // Scenario: after the gap the walk undoes the older Write, not the failed Edit.
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeWriteRows("toolu_A", file.toString(), "update", "M2", "M1", 1), ...makeEditRows("toolu_B", file.toString(), { oldString: "X", newString: "Y" }, 5)]);
    // walk backwards with an extra known state at second 3
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(3, "M2")]);
    // the gap holds the extra text, the extra state follows, then the Write is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:Z", "UnknownChange:M2", "BackupSnapshot:M2", "WriteUndone:M1"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_prefers_the_newest_known_text_among_older_rows_and_extra_states", (t) => {
    // Scenario: the older Write (second 4) is newer than the extra state (second 2).
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeWriteRows("toolu_A", file.toString(), "update", "W", "V", 4), ...makeEditRows("toolu_B", file.toString(), { oldString: "X", newString: "Y" }, 5)]);
    // walk backwards with an extra known state at second 2
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(2, "old")]);
    // the gap holds the Write content; the older extra state comes after the rows
    assert.deepEqual(summarizeStates(states), ["DiskNow:Z", "UnknownChange:W", "WriteUndone:V", "UnknownChange:old", "BackupSnapshot:old"]);
});

test("test_walkFileBackwards_continues_after_FileCreated_with_a_gap_for_an_older_row", (t) => {
    // Scenario: the file was made, deleted, and made again: the older Write-create does not match the absent state.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeWriteRows("toolu_A", file.toString(), "create", "A", null, 1), ...makeWriteRows("toolu_B", file.toString(), "create", "B", null, 3)]);
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk passes FileCreated, a gap holding "A", then FileCreated again
    assert.deepEqual(summarizeStates(states), ["DiskNow:B", "FileCreated:undefined", "UnknownChange:A", "FileCreated:undefined"]);
});

test("test_walkFileBackwards_makes_a_gap_when_the_file_is_absent_on_disk_but_a_Write_row_exists", (t) => {
    // Scenario: the file was deleted after the Write.
    const file = makeTargetFile(t, undefined);
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // a gap holds the Write content, then the Write is undone
    assert.deepEqual(summarizeStates(states), ["DiskNow:undefined", "UnknownChange:B", "WriteUndone:A"]);
});

test("test_walkFileBackwards_stops_when_a_Write_update_has_a_null_originalFile_and_nothing_older_is_known", (t) => {
    // Scenario: the Write-update row has no earlier text, so the walk cannot step back past it.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", null, 1));
    // walk backwards
    const states = walkFileBackwards(file, new Path(jsonlFolder), []);
    // the walk stops at the disk state
    assert.deepEqual(summarizeStates(states), ["DiskNow:B"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_a_GitCommit_state_with_its_commit_hash_when_the_disk_text_equals_the_commit_text", (t) => {
    // Scenario: no row changed the file, and the one commit holds the disk text.
    const file = makeTargetFile(t, "A");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    // walk backwards with one commit state at second 5
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(5, "A")]);
    // the commit state follows the disk state with no gap between them
    assert.deepEqual(summarizeStates(states), ["DiskNow:A", "GitCommit:A"]);
    // the commit state carries the commit hash and the commit instant
    assert.deepEqual(states[1]!.commitHash, new Uuid(FAKE_COMMIT_HASH));
    assert.deepEqual(states[1]!.timestamp, makeInstant(5));
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_makes_an_UnknownChange_gap_before_a_commit_whose_text_differs_from_the_disk_text", (t) => {
    // Scenario: the disk text is not the commit text, and no script names the file.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    // walk backwards with one commit state at second 5
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(5, "A")]);
    // the gap holds the commit text, then the commit state follows
    assert.deepEqual(summarizeStates(states), ["DiskNow:X", "UnknownChange:A", "GitCommit:A"]);
    // the gap is stamped with the commit instant and has no commit hash
    assert.deepEqual(states[1]!.timestamp, makeInstant(5));
    assert.equal(states[1]!.commitHash, undefined);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_marks_the_gap_before_a_commit_ScriptChange_when_a_Bash_call_names_the_file_inside_the_window", (t) => {
    // Scenario: a Bash call that names a.txt ran after the commit.
    const file = makeTargetFile(t, "X");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeBashRows("toolu_B", "sed -i s/A/X/ ./a.txt", 7));
    // walk backwards with one commit state at second 5
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(5, "A")]);
    // the gap is a ScriptChange and the commit state follows
    assert.deepEqual(states.map((state) => state.kind), [ReverseStateKind.DiskNow, ReverseStateKind.ScriptChange, ReverseStateKind.GitCommit]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_a_BackupSnapshot_state_with_the_transcript_file_and_line_of_its_snapshot_row", (t) => {
    // Scenario: a backup state knows the snapshot row it came from.
    const file = makeTargetFile(t, "A");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    const backupState: KnownFileState = { timestamp: makeInstant(5), content: "A", commitHash: undefined, source: { filePath: "/s/s1.jsonl", lineNumber: 4 } };
    // walk backwards with that backup state
    const states = walkFileBackwards(file, new Path(jsonlFolder), [backupState]);
    // the state is a BackupSnapshot with the transcript file and line, and no commit hash
    assert.equal(states[1]!.kind, ReverseStateKind.BackupSnapshot);
    assert.deepEqual(states[1]!.jsonlPath, new Path("/s/s1.jsonl"));
    assert.equal(states[1]!.lineNumber, 4);
    assert.equal(states[1]!.commitHash, undefined);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_places_a_known_state_between_the_two_rows_around_its_instant", (t) => {
    // Scenario: a backup at second 3 holds the text between the Edit at second 1 and the Edit at second 5.
    const file = makeTargetFile(t, "C");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", [...makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1), ...makeEditRows("toolu_B", file.toString(), { oldString: "B", newString: "C" }, 5)]);
    // walk backwards with the backup state
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(3, "B")]);
    // the backup state sits between the two undone edits, with no gap because its text equals the text after undoing the newer edit
    assert.deepEqual(summarizeStates(states), ["DiskNow:C", "EditUndone:B", "BackupSnapshot:B", "EditUndone:A"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_a_known_state_older_than_every_row_after_the_last_row", (t) => {
    // Scenario: a commit at second 1 is older than the only Edit at second 5.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards with the commit state
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(1, "A")]);
    // the commit state follows the undone edit
    assert.deepEqual(summarizeStates(states), ["DiskNow:B", "EditUndone:A", "GitCommit:A"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_every_known_state_newest_first_whatever_the_input_order", (t) => {
    // Scenario: two backup states are given oldest first, and no row changed the file.
    const file = makeTargetFile(t, "C");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    // walk backwards with backups at second 2 and second 4
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownBackupState(2, "A"), makeKnownBackupState(4, "B")]);
    // the newer backup comes first, each behind its own gap
    assert.deepEqual(summarizeStates(states), ["DiskNow:C", "UnknownChange:B", "BackupSnapshot:B", "UnknownChange:A", "BackupSnapshot:A"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_keeps_a_backup_and_a_commit_with_the_same_instant_and_text_backup_first", (t) => {
    // Scenario: a backup and a commit share second 3 and the text "A"; the commit is given first.
    const file = makeTargetFile(t, "A");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", []);
    // walk backwards with both known states
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(3, "A"), makeKnownBackupState(3, "A")]);
    // both appear, the backup first
    assert.deepEqual(summarizeStates(states), ["DiskNow:A", "BackupSnapshot:A", "GitCommit:A"]);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_a_commit_once_when_a_failed_row_jumps_to_it", (t) => {
    // Scenario: the Edit fails its check and the commit at second 3 is the newest known text older than it.
    const file = makeTargetFile(t, "Z");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards with the commit state
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(3, "M")]);
    // exactly one GitCommit state exists
    assert.equal(states.filter((state) => state.kind === ReverseStateKind.GitCommit).length, 1);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwards_lists_a_known_state_at_the_instant_of_a_row_before_that_row", (t) => {
    // Scenario: a commit and an Edit share second 5, and the commit holds the text after the Edit.
    const file = makeTargetFile(t, "B");
    const jsonlFolder = makeTempFolder(t);
    writeRecords(jsonlFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 5));
    // walk backwards with the commit state
    const states = walkFileBackwards(file, new Path(jsonlFolder), [makeKnownCommitState(5, "B")]);
    // the commit state comes before the undone edit
    assert.deepEqual(summarizeStates(states), ["DiskNow:B", "GitCommit:B", "EditUndone:A"]);
});

test("test_formatReverseStateLine_prints_now_and_the_byte_length_for_the_disk_state", (t) => {
    // Scenario: the disk state prints "now" in place of a timestamp.
    const state: ReverseFileState = { index: 0, kind: ReverseStateKind.DiskNow, timestamp: undefined, content: "héllo", jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true };
    // format the line
    const line = formatReverseStateLine(state);
    // the length counts bytes, so é counts two
    assert.equal(line, "0  now  DiskNow  6");
});

test("test_formatReverseStateLine_prints_the_ISO_timestamp_and_absent_for_undefined_content", (t) => {
    // Scenario: a FileCreated state prints its ISO timestamp and "absent".
    const state: ReverseFileState = { index: 3, kind: ReverseStateKind.FileCreated, timestamp: makeInstant(1), content: undefined, jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true };
    // format the line
    const line = formatReverseStateLine(state);
    // the line has the four fields
    assert.equal(line, "3  2026-01-01T00:00:01.000Z  FileCreated  absent");
});

test("test_formatReverseStateLine_appends_the_first_seven_characters_of_the_commit_hash_for_a_GitCommit_state", (t) => {
    // Scenario: a GitCommit state carries the commit hash.
    const state: ReverseFileState = { index: 2, kind: ReverseStateKind.GitCommit, timestamp: makeInstant(1), content: "ab", jsonlPath: undefined, lineNumber: undefined, commitHash: new Uuid(FAKE_COMMIT_HASH), isModifying: true };
    //format the line
    const line = formatReverseStateLine(state);
    // the line ends with the short hash
    assert.equal(line, "2  2026-01-01T00:00:01.000Z  GitCommit  2  0123456");
});

test("test_readReverseSettingsFromArguments_returns_undefined_without_the_reverse_flag", (t) => {
    // Scenario: a normal run has no --reverse flag.
    // read the settings
    const settings = readReverseSettingsFromArguments(["--state", "/s", "--jsonl", "/j"]);
    // there are no reverse settings
    assert.equal(settings, undefined);
});

test("test_readReverseSettingsFromArguments_reads_the_file_and_the_jsonls_folder", (t) => {
    // Scenario: --reverse with both flags.
    // read the settings
    const settings = readReverseSettingsFromArguments(["--reverse", "--file", "/a/b.ts", "--jsonls", "/j"]);
    // the file and the folder are Paths
    assert.deepEqual(settings, { file: new Path("/a/b.ts"), jsonlsFolder: new Path("/j") });
});

test("test_readReverseSettingsFromArguments_throws_without_the_file_flag", (t) => {
    // Scenario: --reverse with --jsonls only.
    // reading the settings throws
    assert.throws(() => readReverseSettingsFromArguments(["--reverse", "--jsonls", "/j"]), /--file/);
});

test("test_readReverseSettingsFromArguments_throws_without_the_jsonls_flag", (t) => {
    // Scenario: --reverse with --file only.
    // reading the settings throws
    assert.throws(() => readReverseSettingsFromArguments(["--reverse", "--file", "/a/b.ts"]), /--jsonls/);
});

test("test_engineV3_replay_cli_prints_one_line_per_state_in_reverse_mode", (t) => {
    // Scenario: the real command line prints only the state lines.
    const file = makeGitTargetFile(t);
    commitFileText(file, "one B three", 0);
    const { jsonlsFolder } = makeClaudeHome(t);
    writeRecords(jsonlsFolder, "s1.jsonl", makeEditRows("toolu_A", file.toString(), { oldString: "A", newString: "B" }, 1));
    const projectFolder = join(dirname(fileURLToPath(import.meta.url)), "..");
    // run the command
    const output = execFileSync(process.execPath, ["--import", "tsx", join(projectFolder, "engineV3", "engineV3_replay.ts"), "--reverse", "--file", file.toString(), "--jsonls", jsonlsFolder], { cwd: projectFolder, encoding: "utf8", timeout: 100000 });
    // four lines: the disk state, the undone edit, the gap to the older commit, and the commit with its short hash
    const shortHash = readHeadCommitHash(file).slice(0, 7);
    assert.equal(output, `0  now  DiskNow  11\n1  2026-01-01T00:00:01.000Z  EditUndone  11\n2  2026-01-01T00:00:00.000Z  UnknownChange  11\n3  2026-01-01T00:00:00.000Z  GitCommit  11  ${shortHash}\n`);
});

test("test_engineV3_replay_cli_fills_a_gap_from_a_file_history_backup", (t) => {
    // Scenario: a Write row has no earlier text, and a backup older than the row holds it.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 0);
    writeFileSync(file.toString(), "B");
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "A");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(2) } }), ...makeWriteRows("toolu_A", file.toString(), "update", "B", null, 5)]);
    const projectFolder = join(dirname(fileURLToPath(import.meta.url)), "..");
    // run the command
    const output = execFileSync(process.execPath, ["--import", "tsx", join(projectFolder, "engineV3", "engineV3_replay.ts"), "--reverse", "--file", file.toString(), "--jsonls", jsonlsFolder], { cwd: projectFolder, encoding: "utf8", timeout: 100000 });
    // the backup text is the gap state and then its own state; the older commit follows the same way
    const shortHash = readHeadCommitHash(file).slice(0, 7);
    assert.equal(output, `0  now  DiskNow  1\n1  2026-01-01T00:00:05.000Z  PossibleChange  1\n2  2026-01-01T00:00:02.000Z  UnknownChange  1\n3  2026-01-01T00:00:02.000Z  BackupSnapshot  1\n4  2026-01-01T00:00:00.000Z  UnknownChange  1\n5  2026-01-01T00:00:00.000Z  GitCommit  1  ${shortHash}\n`);
});

test("test_engineV3_replay_cli_fills_a_gap_from_a_git_commit", (t) => {
    // Scenario: a Write row has no earlier text, and a commit older than the row holds it.
    const file = makeGitTargetFile(t);
    commitFileText(file, "A", 2);
    writeFileSync(file.toString(), "B");
    const { jsonlsFolder } = makeClaudeHome(t);
    writeRecords(jsonlsFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", null, 5));
    const projectFolder = join(dirname(fileURLToPath(import.meta.url)), "..");
    // run the command
    const output = execFileSync(process.execPath, ["--import", "tsx", join(projectFolder, "engineV3", "engineV3_replay.ts"), "--reverse", "--file", file.toString(), "--jsonls", jsonlsFolder], { cwd: projectFolder, encoding: "utf8", timeout: 100000 });
    // the commit text is the gap state and then its own state with the short hash
    const shortHash = readHeadCommitHash(file).slice(0, 7);
    assert.equal(output, `0  now  DiskNow  1\n1  2026-01-01T00:00:05.000Z  PossibleChange  1\n2  2026-01-01T00:00:02.000Z  UnknownChange  1\n3  2026-01-01T00:00:02.000Z  GitCommit  1  ${shortHash}\n`);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwardsWithKnownStates_fills_gaps_from_a_backup_and_a_git_commit", (t) => {
    // Scenario: two Write rows with no earlier text; a commit and a backup each hold one older text.
    const file = makeGitTargetFile(t);
    commitFileText(file, "A", 2);
    writeFileSync(file.toString(), "D");
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "C");
    writeRecords(jsonlsFolder, "s1.jsonl", [
        makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(6) } }),
        ...makeWriteRows("toolu_A", file.toString(), "update", "B", null, 5),
        ...makeWriteRows("toolu_B", file.toString(), "update", "D", null, 9),
    ]);
    // walk with the known states
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], [new Path(fileHistoryFolder)]);
    // the backup text and the commit text both appear as gap states, newest first
    const texts = summarizeStates(states);
    assert.equal(texts[0], "DiskNow:D");
    assert.ok(texts.includes("UnknownChange:C"));
    assert.ok(texts.includes("UnknownChange:A"));
    // each known state is also listed as its own state
    assert.ok(texts.includes("BackupSnapshot:C"));
    assert.ok(texts.includes("GitCommit:A"));
});

test("test_walkFileBackwardsWithKnownStates_sees_rows_from_two_transcript_folders", (t) => {
    // Scenario: one Write row sits in each of two transcript folders.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 2);
    writeFileSync(file.toString(), "C");
    const firstHome = makeClaudeHome(t);
    const secondHome = makeClaudeHome(t);
    writeRecords(firstHome.jsonlsFolder, "s1.jsonl", makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 5));
    writeRecords(secondHome.jsonlsFolder, "s2.jsonl", makeWriteRows("toolu_B", file.toString(), "update", "C", "B", 9));
    // walk with both folders
    const states = walkFileBackwardsWithKnownStates(file, [new Path(firstHome.jsonlsFolder), new Path(secondHome.jsonlsFolder)], []);
    // the walk undoes the row of the second folder, then the row of the first folder
    assert.deepEqual(summarizeStates(states).slice(0, 3), ["DiskNow:C", "WriteUndone:B", "WriteUndone:A"]);
});

test("test_walkFileBackwardsWithKnownStates_never_parses_a_line_that_does_not_name_the_file", (t) => {
    // Scenario: a line that is not valid JSON and does not name the file sits before the rows of the file.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 2);
    writeFileSync(file.toString(), "B");
    const { jsonlsFolder } = makeClaudeHome(t);
    const rowLines = makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 5).map((record) => JSON.stringify(record));
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), ["this line is not json {", ...rowLines].join("\n") + "\n");
    // walk with the known states
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], []);
    // the walk does not throw and undoes the row
    assert.deepEqual(summarizeStates(states).slice(0, 2), ["DiskNow:B", "WriteUndone:A"]);
});

test("test_walkFileBackwardsWithKnownStates_records_the_source_line_number_after_unparsed_lines", (t) => {
    // Scenario: two lines that do not name the file come before the call line and the result line.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 2);
    writeFileSync(file.toString(), "B");
    const { jsonlsFolder } = makeClaudeHome(t);
    const rowLines = makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 5).map((record) => JSON.stringify(record));
    const transcriptFile = join(jsonlsFolder, "s1.jsonl");
    writeFileSync(transcriptFile, ["not json one", "not json two", ...rowLines].join("\n") + "\n");
    // walk with the known states
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], []);
    // the undone row points at the result line, line 4 of the transcript
    assert.equal(states[1]!.jsonlPath!.toString(), transcriptFile);
    assert.equal(states[1]!.lineNumber, 4);
});

// skipped: tests a walk rule that engineV3_replay_reverse_events.ts replaces
test.skip("test_walkFileBackwardsWithKnownStates_keeps_the_rows_of_the_file_beside_rows_of_another_file", (t) => {
    // Scenario: the transcript also holds a call and a result for another file name.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 2);
    writeFileSync(file.toString(), "B");
    const { jsonlsFolder } = makeClaudeHome(t);
    const otherRows = makeWriteRows("toolu_O", join(dirname(file.toString()), "other.txt"), "update", "Y", "X", 4);
    const fileRows = makeWriteRows("toolu_A", file.toString(), "update", "B", "A", 5);
    writeRecords(jsonlsFolder, "s1.jsonl", [...otherRows, ...fileRows]);
    // walk with the known states
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], []);
    // the row of the file is undone, the other file adds no state, and the older commit follows
    assert.deepEqual(summarizeStates(states), ["DiskNow:B", "WriteUndone:A", "UnknownChange:Z", "GitCommit:Z"]);
});

test("test_walkFileBackwardsWithKnownStates_finds_a_backup_in_the_second_file_history_folder", (t) => {
    // Scenario: a Write row has no earlier text; only the second of two file-history folders holds the backup.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 8);
    writeFileSync(file.toString(), "D");
    const { jsonlsFolder } = makeClaudeHome(t);
    const firstFileHistoryFolder = makeTempFolder(t);
    const secondFileHistoryFolder = makeTempFolder(t);
    writeBackupFile(secondFileHistoryFolder, "s1", "hash@v1", "C");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(2) } }), ...makeWriteRows("toolu_A", file.toString(), "update", "D", null, 5)]);
    // walk with both file-history folders
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], [new Path(firstFileHistoryFolder), new Path(secondFileHistoryFolder)]);
    // the backup text from the second folder is a gap state
    assert.ok(summarizeStates(states).includes("UnknownChange:C"));
});

test("test_walkFileBackwardsWithKnownStates_resolves_a_relative_key_with_a_cwd_line_that_does_not_name_the_file", (t) => {
    // Scenario: the snapshot key is "a.txt"; the cwd comes from an earlier line that does not name the file.
    const file = makeGitTargetFile(t);
    commitFileText(file, "Z", 8);
    writeFileSync(file.toString(), "D");
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "C");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeCwdRecord(dirname(file.toString()), 1), makeSnapshotRecord("m1", { "a.txt": { backupFileName: "hash@v1", backupTime: makeInstant(2) } }), ...makeWriteRows("toolu_A", file.toString(), "update", "D", null, 5)]);
    // walk with the known states
    const states = walkFileBackwardsWithKnownStates(file, [new Path(jsonlsFolder)], [new Path(fileHistoryFolder)]);
    // the backup text is a gap state
    assert.ok(summarizeStates(states).includes("UnknownChange:C"));
});

test("test_collectBackupKnownStates_returns_the_backup_text_and_backupTime_for_an_absolute_key", (t) => {
    // Scenario: one snapshot row names the file by its absolute path.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "old text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // one state holds the backup bytes at the backup time, with the snapshot row as its source and no commit hash
    assert.deepEqual(states, [{ timestamp: makeInstant(3), content: "old text", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 1 } }]);
});

test("test_collectBackupKnownStates_skips_a_null_backupFileName", (t) => {
    // Scenario: the file did not exist when the snapshot was taken.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder } = makeClaudeHome(t);
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: null, backupTime: makeInstant(3) } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // no state comes back
    assert.deepEqual(states, []);
});

test("test_collectBackupKnownStates_skips_backups_of_other_files", (t) => {
    // Scenario: the snapshot names a different file.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "other text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { "/other/b.txt": { backupFileName: "hash@v1", backupTime: makeInstant(3), realParentDir: "/other" } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // no state comes back
    assert.deepEqual(states, []);
});

test("test_collectBackupKnownStates_drops_the_same_backup_seen_in_two_snapshot_rows", (t) => {
    // Scenario: a later snapshot row repeats the entry of an earlier row.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "old text");
    const entry: BackupEntry = { backupFileName: "hash@v1", backupTime: makeInstant(3) };
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: entry }), makeSnapshotRecord("m2", { [file.toString()]: entry })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // only one state comes back
    assert.equal(states.length, 1);
});

test("test_collectBackupKnownStates_keeps_two_different_versions_of_the_file", (t) => {
    // Scenario: two snapshot rows name two backup versions.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "text one");
    writeBackupFile(fileHistoryFolder, "s1", "hash@v2", "text two");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } }), makeSnapshotRecord("m2", { [file.toString()]: { backupFileName: "hash@v2", backupTime: makeInstant(6) } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // both versions come back
    assert.deepEqual(states, [
        { timestamp: makeInstant(3), content: "text one", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 1 } },
        { timestamp: makeInstant(6), content: "text two", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 2 } },
    ]);
});

test("test_collectBackupKnownStates_resolves_a_relative_key_against_the_session_cwd", (t) => {
    // Scenario: the key is "a.txt" and a row of the same session holds the cwd.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "old text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeCwdRecord(dirname(file.toString()), 1), makeSnapshotRecord("m1", { "a.txt": { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // the backup is found, with the snapshot row (line 2, after the cwd row) as its source
    assert.deepEqual(states, [{ timestamp: makeInstant(3), content: "old text", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 2 } }]);
});

test("test_collectBackupKnownStates_uses_realParentDir_for_a_relative_key", (t) => {
    // Scenario: the key is relative and names its real folder.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder, fileHistoryFolder } = makeClaudeHome(t);
    writeBackupFile(fileHistoryFolder, "s1", "hash@v1", "old text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { "sub/a.txt": { backupFileName: "hash@v1", backupTime: makeInstant(3), realParentDir: dirname(file.toString()) } })]);
    // collect the backup states
    const states = collectBackupStatesFromFolder(file, jsonlsFolder);
    // the backup is found
    assert.deepEqual(states, [{ timestamp: makeInstant(3), content: "old text", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 1 } }]);
});

test("test_engineV3_replay_cli_throws_when_the_derived_file_history_folder_does_not_exist", (t) => {
    // Scenario: the jsonls folder has no file-history folder two levels up.
    const file = makeGitTargetFile(t);
    const jsonlsFolder = join(makeTempFolder(t), "projects", "p");
    mkdirSync(jsonlsFolder, { recursive: true });
    writeRecords(jsonlsFolder, "s1.jsonl", []);
    const projectFolder = join(dirname(fileURLToPath(import.meta.url)), "..");
    // run the command
    const runCommand = () => execFileSync(process.execPath, ["--import", "tsx", join(projectFolder, "engineV3", "engineV3_replay.ts"), "--reverse", "--file", file.toString(), "--jsonls", jsonlsFolder], { cwd: projectFolder, encoding: "utf8", stdio: "pipe", timeout: 100000 });
    // the command fails and names the file-history folder
    assert.throws(runCommand, (error: { stderr: string }) => /file-history/.test(error.stderr));
});

test("test_collectBackupKnownStates_finds_a_backup_in_the_second_file_history_folder", (t) => {
    // Scenario: only the second of two file-history folders holds the backup.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder } = makeClaudeHome(t);
    const firstFileHistoryFolder = makeTempFolder(t);
    const secondFileHistoryFolder = makeTempFolder(t);
    writeBackupFile(secondFileHistoryFolder, "s1", "hash@v1", "old text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    const jsonlLines = loadMergedJSONLLines([jsonlsFolder]).jsonlLines;
    // collect the backup states over both folders
    const states = collectBackupKnownStates(file, jsonlLines, [new Path(firstFileHistoryFolder), new Path(secondFileHistoryFolder)]);
    // the backup text comes from the second folder
    assert.deepEqual(states, [{ timestamp: makeInstant(3), content: "old text", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 1 } }]);
});

test("test_collectBackupKnownStates_finds_a_backup_in_the_file_history_subfolder_of_a_given_folder", (t) => {
    // Scenario: the given folder is a recovery copy of a Claude home, so the backups sit in its file-history subfolder.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder } = makeClaudeHome(t);
    const recoveryFolder = makeTempFolder(t);
    writeBackupFile(join(recoveryFolder, "file-history"), "s1", "hash@v1", "old text");
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    const jsonlLines = loadMergedJSONLLines([jsonlsFolder]).jsonlLines;
    // collect the backup states
    const states = collectBackupKnownStates(file, jsonlLines, [new Path(recoveryFolder)]);
    // the backup text comes from the subfolder
    assert.deepEqual(states, [{ timestamp: makeInstant(3), content: "old text", commitHash: undefined, source: { filePath: join(jsonlsFolder, "s1.jsonl"), lineNumber: 1 } }]);
});

test("test_collectBackupKnownStates_skips_a_backup_found_in_no_file_history_folder", (t) => {
    // Scenario: the snapshot row names a backup that none of the given folders holds.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder } = makeClaudeHome(t);
    const emptyFileHistoryFolder = makeTempFolder(t);
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    const jsonlLines = loadMergedJSONLLines([jsonlsFolder]).jsonlLines;
    // collect the backup states
    const states = collectBackupKnownStates(file, jsonlLines, [new Path(emptyFileHistoryFolder)]);
    // no state comes back and nothing throws
    assert.deepEqual(states, []);
});

test("test_collectBackupKnownStates_skips_a_backup_when_no_file_history_folder_is_given", (t) => {
    // Scenario: the folder list is empty.
    const file = makeTargetFile(t, undefined);
    const { jsonlsFolder } = makeClaudeHome(t);
    writeRecords(jsonlsFolder, "s1.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
    const jsonlLines = loadMergedJSONLLines([jsonlsFolder]).jsonlLines;
    // collect the backup states
    const states = collectBackupKnownStates(file, jsonlLines, []);
    // no state comes back
    assert.deepEqual(states, []);
});

// test("test_collectBackupKnownStates_throws_when_a_snapshot_source_file_is_inside_none_of_the_folders", (t) => {
//     // Scenario: the snapshot row sits in the second transcript folder, but only the first folder is given.
//     const file = makeTargetFile(t, undefined);
//     const firstHome = makeClaudeHome(t);
//     const secondHome = makeClaudeHome(t);
//     writeBackupFile(secondHome.fileHistoryFolder, "s2", "hash@v1", "old text");
//     writeRecords(secondHome.jsonlsFolder, "s2.jsonl", [makeSnapshotRecord("m1", { [file.toString()]: { backupFileName: "hash@v1", backupTime: makeInstant(3) } })]);
//     const jsonlLines = loadMergedJSONLLines([secondHome.jsonlsFolder]).jsonlLines;
//     // collecting with only the first folder throws
//     assert.throws(() => collectBackupKnownStates(file, jsonlLines, [new Path(firstHome.jsonlsFolder)]), /inside none/);
// });

test("test_collectGitKnownStates_returns_the_text_and_committer_date_of_each_commit_that_touched_the_file", (t) => {
    // Scenario: two commits changed the file.
    const file = makeGitTargetFile(t);
    commitFileText(file, "first", 10);
    const firstCommitHash = readHeadCommitHash(file);
    commitFileText(file, "second", 20);
    const secondCommitHash = readHeadCommitHash(file);
    // collect the git states
    const states = collectGitKnownStates(file);
    // one state per commit, newest first, each with its commit hash and no transcript source
    assert.deepEqual(states, [
        { timestamp: makeInstant(20), content: "second", commitHash: new Uuid(secondCommitHash), source: undefined },
        { timestamp: makeInstant(10), content: "first", commitHash: new Uuid(firstCommitHash), source: undefined },
    ]);
});

test("test_collectGitKnownStates_skips_commits_that_did_not_touch_the_file", (t) => {
    // Scenario: a commit changed a different file.
    const file = makeGitTargetFile(t);
    commitFileText(file, "first", 10);
    const firstCommitHash = readHeadCommitHash(file);
    const otherFile = join(dirname(file.toString()), "b.txt");
    writeFileSync(otherFile, "other");
    runGit(dirname(file.toString()), ["add", "b.txt"], 20);
    runGit(dirname(file.toString()), ["commit", "-q", "-m", "other file"], 20);
    // collect the git states
    const states = collectGitKnownStates(file);
    // only the first commit gives a state
    assert.deepEqual(states, [{ timestamp: makeInstant(10), content: "first", commitHash: new Uuid(firstCommitHash), source: undefined }]);
});

test("test_collectGitKnownStates_skips_the_commit_that_deleted_the_file", (t) => {
    // Scenario: the file was committed, then deleted in a later commit.
    const file = makeGitTargetFile(t);
    commitFileText(file, "first", 10);
    const firstCommitHash = readHeadCommitHash(file);
    runGit(dirname(file.toString()), ["rm", "-q", "a.txt"], 20);
    runGit(dirname(file.toString()), ["commit", "-q", "-m", "delete"], 20);
    // collect the git states
    const states = collectGitKnownStates(file);
    // only the commit that held the file gives a state
    assert.deepEqual(states, [{ timestamp: makeInstant(10), content: "first", commitHash: new Uuid(firstCommitHash), source: undefined }]);
});

test("test_collectGitKnownStates_throws_when_the_file_is_not_inside_a_git_repo", (t) => {
    // Scenario: the file sits in a plain temp folder.
    const file = makeTargetFile(t, "text");
    // collecting throws
    assert.throws(() => collectGitKnownStates(file), /git/);
});
