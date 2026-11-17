import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { ReverseStateKind, loadJSONLLinesNamingFile, type ReverseFileState } from "./engineV3_replay_reverse.ts";
import {
    FileEventType, formatUnhandledEventLines, getAllEventsForFileFrom, getAllEventsForFileFromLines, getReverseStatesForFile, isBeaconEvent, isEventTypeHandled, pruneBeaconsFromEvents, sortEventsNewestToOldest,
    type FileEvent, type ReverseEventsResult,
} from "./engineV3_replay_reverse_events.ts";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-reverse-events-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number, cwd: string | undefined = undefined): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), ...(cwd === undefined ? {} : { cwd }), message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, toolUseResult: unknown, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content }, toolUseResult };
}

function makeEditRows(toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string | undefined, second: number): object[] {
    const toolUseResult: Record<string, unknown> = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false };
    if (originalFile !== undefined) {
        toolUseResult.originalFile = originalFile;
    }
    return [makeCallRecord("Edit", toolUseId, { file_path: filePath }, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeWriteCreateRows(toolUseId: string, filePath: string, content: string, second: number): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath }, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeReadRows(toolUseId: string, filePath: string, content: string, numLines: number, totalLines: number, second: number): object[] {
    const toolUseResult = { type: "text", file: { filePath, content, numLines, startLine: 1, totalLines } };
    return [makeCallRecord("Read", toolUseId, { file_path: filePath }, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeBashRows(toolUseId: string, command: string, second: number, cwd: string): object[] {
    return [makeCallRecord("Bash", toolUseId, { command }, second, cwd)];
}

function writeRecords(scene: Scene, records: object[]): void {
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function runGit(folder: string, args: string[], second: number): void {
    const commitDate = makeInstant(second).toISOString();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, stdio: "pipe" });
}

type Scene = { file: Path; jsonlFolder: Path; snapshotFolder: Path; folder: string };

// A git repo holding a.txt with the given disk text, an empty transcripts folder and an empty snapshots folder.
function makeScene(t: TestContext, diskText: string, records: object[] = []): Scene {
    const folder = makeTempFolder(t);
    const jsonlFolder = join(folder, "jsonls");
    const snapshotFolder = join(folder, "file-history");
    mkdirSync(jsonlFolder);
    mkdirSync(snapshotFolder);
    const repoFolder = join(folder, "repo");
    mkdirSync(repoFolder);
    runGit(repoFolder, ["init", "-q"], 0);
    writeFileSync(join(repoFolder, "other.txt"), "other");
    runGit(repoFolder, ["add", "other.txt"], 0);
    runGit(repoFolder, ["commit", "-q", "-m", "first"], 0);
    writeFileSync(join(repoFolder, "a.txt"), diskText);
    const file = new Path(join(repoFolder, "a.txt"));
    writeFileSync(join(jsonlFolder, "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { file, jsonlFolder: new Path(jsonlFolder), snapshotFolder: new Path(snapshotFolder), folder: repoFolder };
}

function commitText(scene: Scene, text: string, second: number): void {
    const diskText = execFileSync("cat", [scene.file.toString()], { encoding: "utf8" });
    writeFileSync(scene.file.toString(), text);
    runGit(scene.folder, ["add", "a.txt"], second);
    runGit(scene.folder, ["commit", "-q", "-m", `commit at ${second}`], second);
    writeFileSync(scene.file.toString(), diskText);
}

function readStates(scene: Scene): ReverseEventsResult {
    return getReverseStatesForFile(scene.file, [scene.jsonlFolder], [scene.snapshotFolder]);
}

function summarizeStates(states: ReverseFileState[]): string[] {
    return states.map((state) => `${state.kind}:${state.content}:${state.isModifying}`);
}

function makeEvent(type: FileEventType, instant: Date | undefined = makeInstant(1), originalFile: string | undefined = undefined): FileEvent {
    const row = { toolName: "Edit", timestamp: makeInstant(1), source: undefined, oldString: "a", newString: "b", replaceAll: false, originalFile };
    return { type, instant, source: undefined, commitHash: undefined, bytes: undefined, row: row as never, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
}

function listScriptMayWriteEventsForFile(scene: Scene, transcriptFile: Path): FileEvent[] {
    const events = getAllEventsForFileFrom(scene.file, transcriptFile, [scene.jsonlFolder], [scene.snapshotFolder]);
    return events.filter((event) => event.type === FileEventType.ScriptMayWrite);
}

const BACKUP_TEXT = Array.from({ length: 20 }, (_, index) => `a${index + 1}`).join("\n") + "\n";
// The user changed lines 3 and 11; the harness shows each changed line with context, and 8 context lines after the last change.
const ELIDED_USER_EDIT_SNIPPET = "2\ta2\n3\tA3\n4\ta4\n...\n10\ta10\n11\tA11\n12\ta12\n13\ta13\n14\ta14\n15\ta15\n16\ta16\n17\ta17\n18\ta18\n19\ta19";
const TEXT_AFTER_USER_EDIT = BACKUP_TEXT.replace("a3\n", "A3\n").replace("a11\n", "A11\n");

// A scene whose log holds a backup of a.txt at second 1 and an edited_text_file notice for a.txt at the given second.
function makeSceneWithBackupAndUserEditNotice(t: TestContext, noticeSecond: number, snippet: string, makeExtraRecords: (file: string) => object[] = () => []): Scene {
    const scene = makeScene(t, "disk");
    mkdirSync(join(scene.snapshotFolder.toString(), "s1"));
    writeFileSync(join(scene.snapshotFolder.toString(), "s1", "abc@v1"), BACKUP_TEXT);
    const backups = { [scene.file.toString()]: { backupFileName: "abc@v1", version: 1, backupTime: makeInstant(1).toISOString() } };
    const snapshotRecord = { type: "file-history-snapshot", messageId: "m1", snapshot: { messageId: "m1", trackedFileBackups: backups, timestamp: makeInstant(1).toISOString() }, isSnapshotUpdate: false };
    const noticeRecord = { type: "attachment", uuid: "notice-1", timestamp: makeInstant(noticeSecond).toISOString(), attachment: { type: "edited_text_file", filename: scene.file.toString(), snippet } };
    writeRecords(scene, [snapshotRecord, ...makeExtraRecords(scene.file.toString()), noticeRecord]);
    return scene;
}

function listEventsOfTypeFromLines(scene: Scene, type: FileEventType): FileEvent[] {
    const jsonlLines = loadJSONLLinesNamingFile(scene.file, [scene.jsonlFolder]);
    return getAllEventsForFileFromLines(scene.file, scene.file, jsonlLines, [scene.snapshotFolder]).filter((event) => event.type === type);
}

test("test_getAllEventsForFileFromLines_lays_an_elided_user_edit_notice_over_the_nearest_older_backup", (t) => {
    // Scenario: a backup at second 1 holds twenty lines; a notice at second 5 shows the lines around a user edit of lines 3 and 11.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 5, ELIDED_USER_EDIT_SNIPPET);
    const noticeEvents = listEventsOfTypeFromLines(scene, FileEventType.UserEditNotice);
    // One notice event, at the notice time, whose bytes are the backup with the shown lines laid over it.
    assert.equal(noticeEvents.length, 1);
    assert.equal(noticeEvents[0]!.instant!.getTime(), makeInstant(5).getTime());
    assert.equal(noticeEvents[0]!.bytes, TEXT_AFTER_USER_EDIT);
});

test("test_getAllEventsForFileFromLines_lays_a_notice_over_a_newer_Edit_text_instead_of_the_older_backup", (t) => {
    // Scenario: the backup is at second 1, an Edit with originalFile at second 3 changes line 5, and the notice is at second 5.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 5, ELIDED_USER_EDIT_SNIPPET, (file) => makeEditRows("e1", file, "a5", "A5", BACKUP_TEXT, 3));
    const noticeEvents = listEventsOfTypeFromLines(scene, FileEventType.UserEditNotice);
    // The text under the notice is the Edit's text, so line 5 stays changed.
    assert.equal(noticeEvents[0]!.bytes, TEXT_AFTER_USER_EDIT.replace("a5\n", "A5\n"));
});

test("test_getAllEventsForFileFromLines_makes_no_notice_event_when_no_backup_is_older_than_the_notice", (t) => {
    // Scenario: the notice at second 0 is older than the only backup, which is at second 1.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 0, ELIDED_USER_EDIT_SNIPPET);
    // There is nothing to lay the notice over.
    assert.equal(listEventsOfTypeFromLines(scene, FileEventType.UserEditNotice).length, 0);
});

test("test_getAllEventsForFileFromLines_makes_no_notice_event_when_the_notice_shows_a_line_past_the_end_of_the_backup", (t) => {
    // Scenario: the backup has twenty lines; the notice shows line 21, so the file was longer than the backup when the notice was made.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 5, "19\ta19\n21\tA21");
    // The notice does not fit the backup, so there is no event.
    assert.equal(listEventsOfTypeFromLines(scene, FileEventType.UserEditNotice).length, 0);
});

test("test_getAllEventsForFileFromLines_makes_no_notice_event_when_the_lines_after_the_change_are_shifted", (t) => {
    // Scenario: the user deleted line 11, so the lines shown after the change sit one line higher than in the backup.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 5, "10\ta10\n11\ta12\n12\ta13\n13\ta14\n14\ta15\n15\ta16\n16\ta17\n17\ta18\n18\ta19");
    // Laying those lines over the backup would give a false text, so there is no event.
    assert.equal(listEventsOfTypeFromLines(scene, FileEventType.UserEditNotice).length, 0);
});

test("test_getAllEventsForFileFrom_does_not_return_user_edit_notice_events", (t) => {
    // Scenario: the same scene as the first notice test, read through the wrapper that the reverse viewer uses.
    const scene = makeSceneWithBackupAndUserEditNotice(t, 5, ELIDED_USER_EDIT_SNIPPET);
    const events = getAllEventsForFileFrom(scene.file, scene.file, [scene.jsonlFolder], [scene.snapshotFolder]);
    // The viewer path stays as it was: no notice event.
    assert.equal(events.some((event) => event.type === FileEventType.UserEditNotice), false);
});

test("test_isBeaconEvent_is_true_for_events_that_carry_the_whole_file", () => {
    // Scenario: the events that carry the whole text by themselves are beacons.
    const beaconTypes = [FileEventType.DiskNow, FileEventType.GitCommit, FileEventType.BackupSnapshot, FileEventType.WriteRow, FileEventType.ReadWhole];
    for (const type of beaconTypes) {
        assert.equal(isBeaconEvent(makeEvent(type)), true, type);
    }
    // an Edit with originalFile is a beacon
    assert.equal(isBeaconEvent(makeEvent(FileEventType.EditRow, makeInstant(1), "text")), true);
});

test("test_isBeaconEvent_is_false_for_events_without_the_whole_file", () => {
    // Scenario: an Edit without originalFile, a partial Read, scripts and other rows carry no whole text.
    assert.equal(isBeaconEvent(makeEvent(FileEventType.EditRow)), false);
    for (const type of [FileEventType.ReadPartial, FileEventType.ScriptReadOnly, FileEventType.ScriptMayWrite, FileEventType.OtherRow]) {
        assert.equal(isBeaconEvent(makeEvent(type)), false, type);
    }
});

test("test_pruneBeaconsFromEvents_keeps_only_the_events_that_are_not_beacons", () => {
    // Scenario: one beacon and one script run go in.
    const events = [makeEvent(FileEventType.GitCommit), makeEvent(FileEventType.ScriptMayWrite)];
    // only the script run stays
    assert.deepEqual(pruneBeaconsFromEvents(events).map((event) => event.type), [FileEventType.ScriptMayWrite]);
});

test("test_isEventTypeHandled_is_true_for_an_Edit_without_originalFile_and_false_for_a_script_run", () => {
    // Scenario: an Edit without originalFile can be worked out from a neighbour; a script run cannot.
    assert.equal(isEventTypeHandled(makeEvent(FileEventType.EditRow)), true);
    assert.equal(isEventTypeHandled(makeEvent(FileEventType.ScriptMayWrite)), false);
});

test("test_sortEventsNewestToOldest_puts_the_disk_event_first", () => {
    // Scenario: a disk event (no instant) and two dated events in mixed order.
    const events = [makeEvent(FileEventType.GitCommit, makeInstant(1)), { ...makeEvent(FileEventType.DiskNow), instant: undefined }, makeEvent(FileEventType.GitCommit, makeInstant(5))];
    // the disk event is first, then the newer commit
    const sorted = sortEventsNewestToOldest(events);
    assert.deepEqual(sorted.map((event) => event.instant?.getTime()), [undefined, makeInstant(5).getTime(), makeInstant(1).getTime()]);
});

test("test_formatUnhandledEventLines_gives_one_line_per_type_with_count_and_newest_instant", () => {
    // Scenario: two script runs and one other row.
    const events = [makeEvent(FileEventType.ScriptMayWrite, makeInstant(1)), makeEvent(FileEventType.ScriptMayWrite, makeInstant(9)), makeEvent(FileEventType.OtherRow, makeInstant(3))];
    // one line per type
    assert.deepEqual(formatUnhandledEventLines(events), [
        "unhandled ScriptMayWrite  count 2  newest 2026-01-01T00:00:09.000Z",
        "unhandled OtherRow  count 1  newest 2026-01-01T00:00:03.000Z",
    ]);
});

test("test_getReverseStatesForFile_lists_a_Write_create_as_a_modifying_FileCreated_state", (t) => {
    // Scenario: the disk text B was written by a create row.
    const scene = makeScene(t, "B");
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeWriteCreateRows("w1", scene.file.toString(), "B", 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the file did not exist before the row
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:B:true", "FileCreated:undefined:true"]);
});

test("test_getReverseStatesForFile_lists_an_Edit_with_originalFile_as_a_modifying_EditUndone_state", (t) => {
    // Scenario: disk B came from an Edit of A with originalFile.
    const scene = makeScene(t, "B", []);
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", scene.file.toString(), "A", "B", "A", 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the state before the Edit is A
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:B:true", "EditUndone:A:true"]);
});

test("test_getReverseStatesForFile_makes_an_UnknownChange_gap_when_the_disk_text_differs_from_the_row_text", (t) => {
    // Scenario: disk is C but the last Edit left B (a hand edit came after).
    const scene = makeScene(t, "C");
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", scene.file.toString(), "A", "B", "A", 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // a gap with the row text sits between disk and the undone Edit
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:C:true", "UnknownChange:B:true", "EditUndone:A:true"]);
});

test("test_getReverseStatesForFile_works_out_an_Edit_without_originalFile_from_the_newer_text", (t) => {
    // Scenario: disk "xBx" came from an Edit A to B with no originalFile.
    const scene = makeScene(t, "xBx");
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", scene.file.toString(), "A", "B", undefined, 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the text before is "xAx"
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:xBx:true", "EditUndone:xAx:true"]);
});

test("test_getReverseStatesForFile_makes_a_PossibleChange_state_when_an_Edit_bytes_cannot_be_worked_out", (t) => {
    // Scenario: disk Z does not hold the Edit's newString and nothing older exists.
    const scene = makeScene(t, "Z");
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", scene.file.toString(), "A", "B", undefined, 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // a modifying PossibleChange keeps the current text, and the event is listed as unhandled
    const result = readStates(scene);
    assert.deepEqual(summarizeStates(result.states), ["DiskNow:Z:true", "PossibleChange:Z:true"]);
    assert.deepEqual(result.unhandledEvents.map((event) => event.type), [FileEventType.RowBytesUnknown]);
});

test("test_getReverseStatesForFile_lists_a_commit_equal_to_the_disk_text_as_a_non_modifying_GitCommit_with_its_hash", (t) => {
    // Scenario: the one commit holds the disk text.
    const scene = makeScene(t, "A");
    commitText(scene, "A", 5);
    // the commit state does not modify and has a hash
    const states = readStates(scene).states;
    assert.deepEqual(summarizeStates(states), ["DiskNow:A:true", "GitCommit:A:false"]);
    assert.equal(states[1]!.commitHash?.toString().length, 40);
});

test("test_getReverseStatesForFile_puts_an_UnknownChange_gap_before_a_commit_whose_text_differs_from_disk", (t) => {
    // Scenario: the commit holds A and the disk holds X.
    const scene = makeScene(t, "X");
    commitText(scene, "A", 5);
    // gap first, then the commit with the same text
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:X:true", "UnknownChange:A:true", "GitCommit:A:false"]);
});

test("test_getReverseStatesForFile_makes_no_gap_below_a_commit_that_explains_the_change", (t) => {
    // Scenario: disk C equals the newest commit; an Edit A to B ran earlier.
    const scene = makeScene(t, "C");
    commitText(scene, "C", 10);
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", scene.file.toString(), "A", "B", "A", 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the commit records the change, so no gap node appears
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:C:true", "GitCommit:C:false", "EditUndone:A:true"]);
});

test("test_getReverseStatesForFile_lists_a_read_only_script_run_as_a_non_modifying_ReadOnly_state", (t) => {
    // Scenario: a Bash call only reads a.txt.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "cat a.txt", 5, scene.folder));
    // the state keeps the current text and does not modify
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "ReadOnly:A:false"]);
});

test("test_getReverseStatesForFile_lists_a_script_run_that_may_write_as_a_modifying_PossibleChange_state", (t) => {
    // Scenario: a Bash call redirects output into a.txt.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "echo hi > a.txt", 5, scene.folder));
    // the state keeps the current text and modifies
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "PossibleChange:A:true"]);
});

test("test_getReverseStatesForFile_lists_a_partial_Read_as_a_non_modifying_ReadOnly_state", (t) => {
    // Scenario: a Read returned 2 of 9 lines.
    const scene = makeScene(t, "A", []);
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeReadRows("r1", scene.file.toString(), "A", 2, 9, 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the state is ReadOnly
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "ReadOnly:A:false"]);
});

test("test_getReverseStatesForFile_lists_a_whole_Read_equal_to_the_disk_text_as_a_non_modifying_ReadOnly_state", (t) => {
    // Scenario: a Read returned the whole file A.
    const scene = makeScene(t, "A", []);
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeReadRows("r1", scene.file.toString(), "A", 1, 1, 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the state is ReadOnly
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "ReadOnly:A:false"]);
});

test("test_getReverseStatesForFile_names_the_gap_ScriptChange_when_a_script_run_names_the_file_inside_the_window", (t) => {
    // Scenario: disk X, a commit with A at second 5, and a Bash call that writes a.txt at second 9.
    const scene = makeScene(t, "X");
    writeRecords(scene, makeBashRows("b1", "echo hi > a.txt", 9, scene.folder));
    commitText(scene, "A", 5);
    // the gap is a ScriptChange
    const kinds = readStates(scene).states.map((state) => state.kind);
    assert.deepEqual(kinds, [ReverseStateKind.DiskNow, ReverseStateKind.PossibleChange, ReverseStateKind.ScriptChange, ReverseStateKind.GitCommit]);
});

test("test_getReverseStatesForFile_lists_a_script_run_that_names_the_file_by_absolute_path_even_when_its_cwd_is_another_project", (t) => {
    // Scenario: a Bash call in another project reads the file by its absolute path.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", `cat ${scene.file.toString()}`, 5, "/other/project"));
    // the absolute path points at the file, so the run has a state
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "ReadOnly:A:false"]);
});

test("test_getReverseStatesForFile_lists_a_script_run_that_names_the_file_by_a_relative_name_when_its_cwd_is_the_project_folder", (t) => {
    // Scenario: a Bash call in the project folder reads a.txt.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "cat a.txt", 5, scene.folder));
    // the name resolves to the file, so the run has a state
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true", "ReadOnly:A:false"]);
});

test("test_getReverseStatesForFile_skips_a_script_run_that_names_the_file_by_a_relative_name_when_its_cwd_is_another_project", (t) => {
    // Scenario: a Bash call in another project reads a file that is also called a.txt.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "cat a.txt", 5, "/other/project"));
    // the name resolves to another file, so only the disk state remains
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true"]);
});

test("test_getReverseStatesForFile_skips_a_script_run_that_names_a_file_with_the_same_name_in_a_sub_folder", (t) => {
    // Scenario: a Bash call in the project folder reads sub/a.txt.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "cat sub/a.txt", 5, scene.folder));
    // sub/a.txt is another file, so only the disk state remains
    assert.deepEqual(summarizeStates(readStates(scene).states), ["DiskNow:A:true"]);
});

test("test_getReverseStatesForFile_finds_rows_by_the_transcript_path_when_it_differs_from_the_disk_path", (t) => {
    // Scenario: the transcripts call the file /original/run/a.txt.
    const scene = makeScene(t, "B");
    writeFileSync(join(scene.jsonlFolder.toString(), "s1.jsonl"), makeEditRows("e1", "/original/run/a.txt", "A", "B", "A", 5).map((record) => JSON.stringify(record)).join("\n") + "\n");
    // the row is found through the extra transcript path
    const result = getReverseStatesForFile(scene.file, [scene.jsonlFolder], [scene.snapshotFolder], new Path("/original/run/a.txt"));
    assert.deepEqual(summarizeStates(result.states), ["DiskNow:B:true", "EditUndone:A:true"]);
});

test("test_getAllEventsForFileFrom_marks_the_destination_of_an_mv_run_as_a_move_or_copy_destination", (t) => {
    // Scenario: a Bash call runs `mv /abs/a.py /abs/b.py`.
    const scene = makeScene(t, "A");
    const sourceFile = join(scene.folder, "a.py");
    const destinationFile = join(scene.folder, "b.py");
    writeRecords(scene, makeBashRows("b1", `mv ${sourceFile} ${destinationFile}`, 5, scene.folder));
    // the ScriptMayWrite event of b.py holds a.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(destinationFile));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(sourceFile)]);
});

test("test_getAllEventsForFileFrom_does_not_mark_the_source_of_an_mv_run_as_a_move_or_copy_destination", (t) => {
    // Scenario: a Bash call runs `mv /abs/a.py /abs/b.py`.
    const scene = makeScene(t, "A");
    const sourceFile = join(scene.folder, "a.py");
    const destinationFile = join(scene.folder, "b.py");
    writeRecords(scene, makeBashRows("b1", `mv ${sourceFile} ${destinationFile}`, 5, scene.folder));
    // the ScriptMayWrite event of a.py has no move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(sourceFile));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [undefined]);
});

test("test_getAllEventsForFileFrom_marks_the_destination_of_a_cp_run_as_a_move_or_copy_destination", (t) => {
    // Scenario: a Bash call runs `cp /abs/a.py /abs/b.py`.
    const scene = makeScene(t, "A");
    const sourceFile = join(scene.folder, "a.py");
    const destinationFile = join(scene.folder, "b.py");
    writeRecords(scene, makeBashRows("b1", `cp ${sourceFile} ${destinationFile}`, 5, scene.folder));
    // the ScriptMayWrite event of b.py holds a.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(destinationFile));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(sourceFile)]);
});

test("test_a_bash_run_of_ls_and_rm_joined_by_a_double_ampersand_removes_the_file", (t) => {
    // Scenario: a Bash call in the project folder runs `ls && rm a.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "ls && rm a.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/a.py is marked as removed by the script
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "a.py")));
    assert.deepEqual(events.map((event) => event.removedByScript), [true]);
});

test("test_a_bash_run_of_two_mv_commands_joined_by_a_double_ampersand_moves_the_second_file_away", (t) => {
    // Scenario: a Bash call in the project folder runs `mv a.py b.py && mv c.py d.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "mv a.py b.py && mv c.py d.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/c.py holds <cwd>/d.py as the file it moved away to
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "c.py")));
    assert.deepEqual(events.map((event) => event.movedAwayToFile), [new Path(join(scene.folder, "d.py"))]);
});

test("test_a_bash_run_of_two_mv_commands_joined_by_a_double_ampersand_gives_the_source_of_the_second_move", (t) => {
    // Scenario: a Bash call in the project folder runs `mv a.py b.py && mv c.py d.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "mv a.py b.py && mv c.py d.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/d.py holds <cwd>/c.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "d.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "c.py"))]);
});

test("test_a_bash_run_of_cp_then_rm_joined_by_a_semicolon_gives_the_copy_source", (t) => {
    // Scenario: a Bash call in the project folder runs `cp a.py b.py; rm a.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "cp a.py b.py; rm a.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/b.py holds <cwd>/a.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "a.py"))]);
});

test("test_a_run_that_is_not_bash_is_not_cut", (t) => {
    // Scenario: a ctx_execute Python run in the project folder has the text `ls && rm a.py` as its code.
    const scene = makeScene(t, "A");
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code: "ls && rm a.py" }, 5, scene.folder)]);
    // the text is not cut at the double ampersand, so the event of <cwd>/a.py is not marked as removed
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "a.py")));
    assert.deepEqual(events.map((event) => event.removedByScript), [false]);
});

test("test_getAllEventsForFileFrom_marks_the_destination_of_a_relative_git_mv_run_as_a_move_or_copy_destination", (t) => {
    // Scenario: a Bash call in the project folder runs `git mv a.py b.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "git mv a.py b.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/b.py holds <cwd>/a.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "a.py"))]);
});

test("test_getAllEventsForFileFrom_marks_the_destination_of_an_inline_python_shutil_move_as_a_move_or_copy_destination", (t) => {
    // Scenario: a ctx_execute Python run in the project folder calls shutil.move("a.py", "b.py").
    const scene = makeScene(t, "A");
    const code = 'import shutil\nshutil.move("a.py", "b.py")';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // the ScriptMayWrite event of <cwd>/b.py holds <cwd>/a.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "a.py"))]);
});

test("test_getAllEventsForFileFrom_does_not_mark_a_write_that_is_not_a_move_or_copy_as_a_move_or_copy_destination", (t) => {
    // Scenario: a Bash call runs `sed -i 's/x/y/' /abs/b.py`, which writes b.py but moves nothing.
    const scene = makeScene(t, "A");
    const editedFile = join(scene.folder, "b.py");
    writeRecords(scene, makeBashRows("b1", `sed -i 's/x/y/' ${editedFile}`, 5, scene.folder));
    // the ScriptMayWrite event of b.py has no move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(editedFile));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [undefined]);
});

test("test_getAllEventsForFileFrom_gives_the_variable_named_shutil_move_source_to_the_destination_event", (t) => {
    // Scenario: a ctx_execute Python run in the project folder assigns src and dst, then calls shutil.move(src, dst).
    const scene = makeScene(t, "A");
    const code = 'import shutil\n\nsrc, dst = "inventory.py", "core_inventory.py"\nshutil.move(src, dst)\nprint(f"Renamed: {src} -> {dst}")';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // the ScriptMayWrite event of <cwd>/core_inventory.py holds <cwd>/inventory.py as its move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "core_inventory.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "inventory.py"))]);
});

test("test_getAllEventsForFileFrom_gives_no_move_source_to_the_source_event_of_a_variable_named_shutil_move", (t) => {
    // Scenario: the same run as above.
    const scene = makeScene(t, "A");
    const code = 'import shutil\n\nsrc, dst = "inventory.py", "core_inventory.py"\nshutil.move(src, dst)\nprint(f"Renamed: {src} -> {dst}")';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // the ScriptMayWrite event of <cwd>/inventory.py has no move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "inventory.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [undefined]);
});

test("test_getAllEventsForFileFrom_follows_the_call_order_of_the_variable_names_in_a_swapped_shutil_move", (t) => {
    // Scenario: a ctx_execute Python run assigns src and dst, then calls shutil.move(dst, src).
    const scene = makeScene(t, "A");
    const code = 'import shutil\nsrc, dst = "a.py", "b.py"\nshutil.move(dst, src)';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // b.py is the source here, so its event has no move or copy source
    const sourceEvents = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(sourceEvents.map((event) => event.moveOrCopySourceFile), [undefined]);
    // a.py is the destination here, so its event holds b.py as its move or copy source
    const destinationEvents = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "a.py")));
    assert.deepEqual(destinationEvents.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "b.py"))]);
});

test("test_getAllEventsForFileFrom_gives_no_move_source_when_the_names_are_built_at_run_time", (t) => {
    // Scenario: a ctx_execute Python run builds the names in a loop with f-strings, then calls shutil.move(old, new).
    const scene = makeScene(t, "A");
    const code = 'import shutil\nfor n in ("one","two","three"):\n    old, new = f"{n}.py", f"core_{n}.py"\n    shutil.move(old, new)';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // any ScriptMayWrite event of <cwd>/core_one.py has no move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "core_one.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), events.map(() => undefined));
});

test("test_getAllEventsForFileFrom_gives_no_move_source_when_a_name_is_assigned_again_before_the_move", (t) => {
    // Scenario: a ctx_execute Python run assigns src and dst, assigns dst again, then calls shutil.move(src, dst).
    const scene = makeScene(t, "A");
    const code = 'import shutil\nsrc, dst = "a.py", "b.py"\ndst = "c.py"\nshutil.move(src, dst)';
    writeRecords(scene, [makeCallRecord("mcp__plugin_context-mode_context-mode__ctx_execute", "b1", { language: "python", code }, 5, scene.folder)]);
    // any ScriptMayWrite event of <cwd>/b.py has no move or copy source
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), events.map(() => undefined));
});

const SCENARIOS_EXECUTED_FOLDER = "/Users/matkatmusicllc/Desktop/claude code src/tui-progress-worktree/jfred/scenarios/executed";
const S1_JSONL_FILE = join(SCENARIOS_EXECUTED_FOLDER, "s1-delete-file", "a35bc28e-3687-4c06-ac02-2c4daebc964b.jsonl");
const S1_RECORDED_FOLDER = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.y4hths0f";
const S2_JSONL_FILE = join(SCENARIOS_EXECUTED_FOLDER, "s2-move-file", "70781551-ea2a-4ae3-a0db-e9e1bb6fee1f.jsonl");
const S2_RECORDED_FOLDER = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.bbkg5qkl";

// The scenario's JSONL is copied unchanged into the scene's transcripts folder; the recorded path is the transcript path of the file.
function listEventsOfRecordedFile(scene: Scene, scenarioJsonlFile: string, recordedFile: string): FileEvent[] {
    writeFileSync(join(scene.jsonlFolder.toString(), "scenario.jsonl"), readFileSync(scenarioJsonlFile, "utf8"));
    return getAllEventsForFileFrom(scene.file, new Path(recordedFile), [scene.jsonlFolder], [scene.snapshotFolder]);
}

test("test_getAllEventsForFileFrom_marks_the_first_rm_target_of_the_s1_run_as_removed_by_script", (t) => {
    // Scenario: s1 runs one rm call with two targets; this is the first target.
    const scene = makeScene(t, "A");
    const events = listEventsOfRecordedFile(scene, S1_JSONL_FILE, join(S1_RECORDED_FOLDER, "s1_delete.py"));
    // exactly one event is marked, and it is the script event
    const markedEvents = events.filter((event) => event.removedByScript);
    assert.deepEqual(markedEvents.map((event) => event.type), [FileEventType.ScriptMayWrite]);
});

test("test_getAllEventsForFileFrom_marks_the_second_rm_target_of_the_s1_run_as_removed_by_script", (t) => {
    // Scenario: s1 runs one rm call with two targets; this is the second target.
    const scene = makeScene(t, "A");
    const events = listEventsOfRecordedFile(scene, S1_JSONL_FILE, join(S1_RECORDED_FOLDER, "tests", "test_s1_delete.py"));
    // exactly one event is marked, and it is the script event
    const markedEvents = events.filter((event) => event.removedByScript);
    assert.deepEqual(markedEvents.map((event) => event.type), [FileEventType.ScriptMayWrite]);
});

test("test_getAllEventsForFileFrom_does_not_mark_the_write_events_of_s1_as_removed_by_script", (t) => {
    // Scenario: s1 writes s1_delete.py, then removes it.
    const scene = makeScene(t, "A");
    const events = listEventsOfRecordedFile(scene, S1_JSONL_FILE, join(S1_RECORDED_FOLDER, "s1_delete.py"));
    // the Write row event exists and is not marked
    const writeEvents = events.filter((event) => event.type === FileEventType.WriteRow);
    assert.equal(writeEvents.length, 1);
    assert.equal(writeEvents[0]!.removedByScript, false);
});

test("test_getAllEventsForFileFrom_gives_the_s2_source_file_the_destination_it_moved_to", (t) => {
    // Scenario: s2 runs `mv s2_original.py s2_moved.py`.
    const scene = makeScene(t, "A");
    const events = listEventsOfRecordedFile(scene, S2_JSONL_FILE, join(S2_RECORDED_FOLDER, "s2_original.py"));
    // exactly one event of the source file holds the destination
    const movedAwayEvents = events.filter((event) => event.movedAwayToFile !== undefined);
    assert.deepEqual(movedAwayEvents.map((event) => event.movedAwayToFile), [new Path(join(S2_RECORDED_FOLDER, "s2_moved.py"))]);
});

test("test_getAllEventsForFileFrom_does_not_give_the_s2_destination_file_a_moved_away_destination", (t) => {
    // Scenario: s2 runs `mv s2_original.py s2_moved.py`; the file read here is the destination.
    const scene = makeScene(t, "A");
    const events = listEventsOfRecordedFile(scene, S2_JSONL_FILE, join(S2_RECORDED_FOLDER, "s2_moved.py"));
    // the mv run is an event of the destination file, and it is not marked as moved away
    assert.equal(events.some((event) => event.type === FileEventType.ScriptMayWrite), true);
    assert.equal(events.some((event) => event.movedAwayToFile !== undefined), false);
});

test("test_getAllEventsForFileFrom_does_not_mark_the_s2_run_as_removed_by_script", (t) => {
    // Scenario: s2 runs `mv s2_original.py s2_moved.py`.
    const scene = makeScene(t, "A");
    const sourceEvents = listEventsOfRecordedFile(scene, S2_JSONL_FILE, join(S2_RECORDED_FOLDER, "s2_original.py"));
    // the mv run is an event of the source file, and it is not marked as removed
    assert.equal(sourceEvents.some((event) => event.type === FileEventType.ScriptMayWrite), true);
    assert.equal(sourceEvents.some((event) => event.removedByScript), false);
    const destinationEvents = listEventsOfRecordedFile(scene, S2_JSONL_FILE, join(S2_RECORDED_FOLDER, "s2_moved.py"));
    assert.equal(destinationEvents.some((event) => event.removedByScript), false);
});

test("test_getAllEventsForFileFrom_marks_a_relative_rm_run_as_removed_by_script", (t) => {
    // Scenario: a Bash call in the project folder runs `rm a.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "rm a.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/a.py is marked as removed
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "a.py")));
    assert.deepEqual(events.map((event) => event.removedByScript), [true]);
});

test("test_getAllEventsForFileFrom_marks_an_rm_run_with_a_flag_as_removed_by_script", (t) => {
    // Scenario: a Bash call runs `rm -f /abs/a.py`.
    const scene = makeScene(t, "A");
    const file = join(scene.folder, "a.py");
    writeRecords(scene, makeBashRows("b1", `rm -f ${file}`, 5, scene.folder));
    // the ScriptMayWrite event of a.py is marked as removed
    const events = listScriptMayWriteEventsForFile(scene, new Path(file));
    assert.deepEqual(events.map((event) => event.removedByScript), [true]);
});

test("test_getAllEventsForFileFrom_gives_a_relative_git_mv_source_its_absolute_destination", (t) => {
    // Scenario: a Bash call in the project folder runs `git mv a.py b.py`.
    const scene = makeScene(t, "A");
    writeRecords(scene, makeBashRows("b1", "git mv a.py b.py", 5, scene.folder));
    // the ScriptMayWrite event of <cwd>/a.py holds <cwd>/b.py as its moved-away destination
    const events = listScriptMayWriteEventsForFile(scene, new Path(join(scene.folder, "a.py")));
    assert.deepEqual(events.map((event) => event.movedAwayToFile), [new Path(join(scene.folder, "b.py"))]);
});

test("test_getAllEventsForFileFrom_does_not_mark_a_cp_run_as_removed_or_moved_away", (t) => {
    // Scenario: a Bash call runs `cp /abs/a.py /abs/b.py`.
    const scene = makeScene(t, "A");
    const sourceFile = join(scene.folder, "a.py");
    writeRecords(scene, makeBashRows("b1", `cp ${sourceFile} ${join(scene.folder, "b.py")}`, 5, scene.folder));
    // the ScriptMayWrite event of the copy source is neither removed nor moved away
    const events = listScriptMayWriteEventsForFile(scene, new Path(sourceFile));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.removedByScript, false);
    assert.equal(events[0]!.movedAwayToFile, undefined);
});

const MOVE_FILES_SCRIPT_BODY = 'import shutil\nshutil.move("a.py", "b.py")';

function makeWrittenScriptRows(toolUseId: string, scriptFile: string, body: string, second: number): object[] {
    return [makeCallRecord("Write", toolUseId, { file_path: scriptFile, content: body }, second)];
}

// The lines are the ones that name the script file, because the run names the target only through the script body.
function listScriptEventsThroughIndirection(scene: Scene, scriptFile: string, targetFile: Path): FileEvent[] {
    const jsonlLines = loadJSONLLinesNamingFile(new Path(scriptFile), [scene.jsonlFolder]);
    const events = getAllEventsForFileFromLines(scene.file, targetFile, jsonlLines, [scene.snapshotFolder], true);
    return events.filter((event) => event.type === FileEventType.ScriptReadOnly || event.type === FileEventType.ScriptMayWrite);
}

test("test_run_that_calls_a_written_script_names_the_target_through_the_script_body", (t) => {
    // Scenario: a Write makes move_files.py, whose body moves a.py to b.py, then a Bash call runs `python3 move_files.py`.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "move_files.py");
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, MOVE_FILES_SCRIPT_BODY, 3), ...makeBashRows("b1", "python3 move_files.py", 5, scene.folder)]);
    // with indirection on, b.py gets one script event from that run
    const events = listScriptEventsThroughIndirection(scene, scriptFile, new Path(join(scene.folder, "b.py")));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, FileEventType.ScriptMayWrite);
});

test("test_exec_open_run_of_a_written_script_names_the_target_through_the_script_body", (t) => {
    // Scenario: the same Write, then a Bash call runs `python3 -c 'exec(open("move_files.py").read())'`.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "move_files.py");
    const command = `python3 -c 'exec(open("move_files.py").read())'`;
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, MOVE_FILES_SCRIPT_BODY, 3), ...makeBashRows("b1", command, 5, scene.folder)]);
    // with indirection on, b.py gets one script event from that run
    const events = listScriptEventsThroughIndirection(scene, scriptFile, new Path(join(scene.folder, "b.py")));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, FileEventType.ScriptMayWrite);
});

test("test_move_in_the_script_body_sets_the_move_or_copy_source_file", (t) => {
    // Scenario: the script body calls shutil.move("a.py", "b.py") and a Bash call in the project folder runs it.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "move_files.py");
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, MOVE_FILES_SCRIPT_BODY, 3), ...makeBashRows("b1", "python3 move_files.py", 5, scene.folder)]);
    // the event of b.py holds <cwd>/a.py as its move or copy source
    const events = listScriptEventsThroughIndirection(scene, scriptFile, new Path(join(scene.folder, "b.py")));
    assert.deepEqual(events.map((event) => event.moveOrCopySourceFile), [new Path(join(scene.folder, "a.py"))]);
});

test("test_script_event_holds_the_resolved_script_run", (t) => {
    // Scenario: the same Write and run as the move test.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "move_files.py");
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, MOVE_FILES_SCRIPT_BODY, 3), ...makeBashRows("b1", "python3 move_files.py", 5, scene.folder)]);
    // the event holds the run with the script body as its code and the called command kept
    const events = listScriptEventsThroughIndirection(scene, scriptFile, new Path(join(scene.folder, "b.py")));
    assert.equal(events[0]!.scriptRun!.code, MOVE_FILES_SCRIPT_BODY);
    assert.equal(events[0]!.scriptRun!.invokedScriptFile, "move_files.py");
    assert.equal(events[0]!.scriptRun!.invokedCommand, "python3 move_files.py");
});

test("test_run_of_an_unwritten_script_stays_a_raw_run", (t) => {
    // Scenario: a Bash call runs `python3 b.py`, and no Write made b.py.
    const scene = makeScene(t, "A");
    const targetFile = join(scene.folder, "b.py");
    writeRecords(scene, makeBashRows("b1", "python3 b.py", 5, scene.folder));
    // the event holds the run unchanged: its code is the command and no script file is recorded
    const events = listScriptEventsThroughIndirection(scene, targetFile, new Path(targetFile));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.scriptRun!.code, "python3 b.py");
    assert.equal(events[0]!.scriptRun!.invokedScriptFile, undefined);
});

test("test_old_walk_entry_does_not_resolve_script_indirection", (t) => {
    // Scenario: the Write of move_files.py moves b.py, and a Bash call runs `python3 move_files.py b.py`, which names b.py itself.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "move_files.py");
    const command = "python3 move_files.py b.py";
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, MOVE_FILES_SCRIPT_BODY, 3), ...makeBashRows("b1", command, 5, scene.folder)]);
    // the old walk gives b.py one read-only script event that holds the raw command, not the script body
    const events = getAllEventsForFileFrom(scene.file, new Path(join(scene.folder, "b.py")), [scene.jsonlFolder], [scene.snapshotFolder]);
    const scriptEvents = events.filter((event) => event.type === FileEventType.ScriptMayWrite || event.type === FileEventType.ScriptReadOnly);
    assert.equal(scriptEvents.length, 1);
    assert.equal(scriptEvents[0]!.type, FileEventType.ScriptReadOnly);
    assert.equal(scriptEvents[0]!.scriptRun!.code, command);
});

function makeErroredResultRecord(toolUseId: string, text: string, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: text, is_error: true }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content } };
}

test("test_blocked_call_whose_error_line_names_no_file_is_not_a_script_event", (t) => {
    // Scenario: a Write makes mk.py, whose body names f.txt. A Bash call runs `python3 mk.py f.txt` and a hook blocks it with an error result that names no file.
    const scene = makeScene(t, "A");
    const scriptFile = join(scene.folder, "mk.py");
    const command = "python3 mk.py f.txt";
    const blockedRows = [...makeBashRows("b1", command, 5, scene.folder), makeErroredResultRecord("b1", "No compound commands", 5)];
    // a later Bash call runs the same command and its result is normal
    const laterRows = [...makeBashRows("b2", command, 8, scene.folder), makeResultRecord("b2", {}, 8)];
    writeRecords(scene, [...makeWrittenScriptRows("w1", scriptFile, 'open("f.txt", "w")', 3), ...blockedRows, ...laterRows]);
    // the walk of f.txt gives one script event, the later call, and none for the blocked call
    const events = getAllEventsForFileFrom(scene.file, new Path(join(scene.folder, "f.txt")), [scene.jsonlFolder], [scene.snapshotFolder]);
    const scriptEvents = events.filter((event) => event.type === FileEventType.ScriptMayWrite || event.type === FileEventType.ScriptReadOnly);
    assert.equal(scriptEvents.length, 1);
    assert.equal(scriptEvents[0]!.instant!.getTime(), makeInstant(8).getTime() - 1);
});
