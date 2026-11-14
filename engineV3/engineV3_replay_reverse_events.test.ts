import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { ReverseStateKind, type ReverseFileState } from "./engineV3_replay_reverse.ts";
import {
    FileEventType, formatUnhandledEventLines, getReverseStatesForFile, isBeaconEvent, isEventTypeHandled, pruneBeaconsFromEvents, sortEventsNewestToOldest,
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
    return { type, instant, source: undefined, commitHash: undefined, bytes: undefined, row: row as never };
}

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
