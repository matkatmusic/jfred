import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { getDiffTextBetweenInstants, getInverseCommitAtInstant, listProjectFileStatesAtInstant, selectInverseCommitAtInstant } from "./engineV3_inverse_repo_read.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";

const FILE_NAME = "a.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeTempFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-inverse-repo-read-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeOrderedState(position: number, second: number | undefined, moment: StateMoment, text: string | undefined): OrderedKnownState {
    let eventType = FileEventType.GitCommit;
    let instant: Date | undefined;
    if (second === undefined) {
        eventType = FileEventType.DiskNow;
    } else {
        instant = makeInstant(second);
    }
    const event = { type: eventType, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
    const state: FileKnownState = { event, moment, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text };
    return { state, position };
}

// Position 0 is the disk-now state; a larger position is older.
function makeRepo(repoFolder: Path, fileName: string, diskNowText: string, olderStates: OrderedKnownState[]): void {
    createInverseRepo(repoFolder, fileName, makeOrderedState(0, undefined, StateMoment.AtEvent, diskNowText), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(repoFolder, fileName, olderStates);
}

function makeThreeAtEventStatesRepo(t: TestContext): Path {
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "now\n", [
        makeOrderedState(1, 300, StateMoment.AtEvent, "three\n"),
        makeOrderedState(2, 200, StateMoment.AtEvent, "two\n"),
        makeOrderedState(3, 100, StateMoment.AtEvent, "one\n"),
    ]);
    return repoFolder;
}

test("test_instant_after_the_newest_state_gives_the_newest_dated_commit", (t) => {
    // Scenario: the rule is "the newest at-event state at or before the instant".
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The instant is second 400, after all of them.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(400));
    // The commit of second 300 is returned.
    assert.equal(commit!.text, "three\n");
});

test("test_instant_between_two_states_gives_the_older_one", (t) => {
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The instant is second 250, between 200 and 300.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(250));
    // The commit of second 200 is returned.
    assert.equal(commit!.text, "two\n");
});

test("test_instant_exactly_at_an_at_event_state_gives_that_state", (t) => {
    // An at-event state is in force from its instant on.
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The instant is exactly second 200.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(200));
    // The commit of second 200 is returned.
    assert.equal(commit!.text, "two\n");
});

test("test_instant_exactly_at_a_before_event_state_gives_the_newer_before_event_state", (t) => {
    // A before-event state is in force just before its instant, so it is not in force at its instant.
    // Two before-event states are stored: second 300 holds "before-300" and second 200 holds "before-200".
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "now\n", [
        makeOrderedState(1, 300, StateMoment.BeforeEvent, "before-300\n"),
        makeOrderedState(2, 200, StateMoment.BeforeEvent, "before-200\n"),
    ]);
    // The instant is exactly second 200.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(200));
    // The state of second 200 is not in force; the file kept the text of "before-300" until second 300.
    assert.equal(commit!.text, "before-300\n");
});

test("test_instant_after_a_before_event_state_with_an_at_event_state_newer_gives_undefined", (t) => {
    // Second 300 has only an at-event state and second 200 has only a before-event state, so the text between 200 and 300 is not known.
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "now\n", [
        makeOrderedState(1, 300, StateMoment.AtEvent, "at-300\n"),
        makeOrderedState(2, 200, StateMoment.BeforeEvent, "before-200\n"),
    ]);
    // The instant is second 250.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(250));
    // No commit tells the state.
    assert.equal(commit, undefined);
});

test("test_instant_older_than_the_oldest_state_gives_undefined", (t) => {
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The instant is second 50, older than all of them.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(50));
    // No commit is returned.
    assert.equal(commit, undefined);
});

test("test_file_absent_at_the_instant_gives_a_commit_marked_absent", (t) => {
    // The file was absent from second 200 on, and had text at second 100.
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "now\n", [
        makeOrderedState(1, 200, StateMoment.AtEvent, undefined),
        makeOrderedState(2, 100, StateMoment.AtEvent, "one\n"),
    ]);
    // The instant is second 250.
    const commit = getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(250));
    // The commit says the file is absent and holds no text.
    assert.equal(commit!.isFileAbsent, true);
    assert.equal(commit!.text, undefined);
});

test("test_diff_text_between_two_instants_holds_the_changed_line", (t) => {
    // The file had "line a / line OLD" from second 200 and "line a / line NEW" from second 300.
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "line a\nline NEW\n", [
        makeOrderedState(1, 300, StateMoment.AtEvent, "line a\nline NEW\n"),
        makeOrderedState(2, 200, StateMoment.AtEvent, "line a\nline OLD\n"),
    ]);
    // The difference is read from second 250 to second 350.
    const diffText = getDiffTextBetweenInstants(repoFolder, FILE_NAME, makeInstant(250), makeInstant(350));
    // The old line is removed and the new line is added.
    assert.ok(diffText.includes("-line OLD\n"));
    assert.ok(diffText.includes("+line NEW\n"));
});

test("test_diff_text_throws_when_an_instant_has_no_commit", (t) => {
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The older instant is second 50, which has no commit.
    assert.throws(() => getDiffTextBetweenInstants(repoFolder, FILE_NAME, makeInstant(50), makeInstant(350)));
});

test("test_project_function_returns_one_entry_per_file_in_the_order_of_the_files", (t) => {
    // A project has two files; each has a repo in the store folder.
    const storeFolder = makeTempFolder(t);
    const projectFolder = new Path("/project");
    const firstFile = new Path("/project/sub/b.txt");
    const secondFile = new Path("/project/a.txt");
    makeRepo(new Path(join(storeFolder.toString(), "sub/b.txt.git")), "b.txt", "now b\n", [makeOrderedState(1, 100, StateMoment.AtEvent, "old b\n")]);
    makeRepo(new Path(join(storeFolder.toString(), "a.txt.git")), "a.txt", "now a\n", [makeOrderedState(1, 100, StateMoment.AtEvent, "old a\n")]);
    // The states are listed for second 150 with the files in the order b, a.
    const entries = listProjectFileStatesAtInstant(storeFolder, projectFolder, [firstFile, secondFile], makeInstant(150));
    // There are two entries, in that order, each with the text of its own file.
    assert.equal(entries.length, 2);
    assert.ok(entries[0]!.file.equals(firstFile));
    assert.equal(entries[0]!.commit!.text, "old b\n");
    assert.ok(entries[1]!.file.equals(secondFile));
    assert.equal(entries[1]!.commit!.text, "old a\n");
});

test("test_select_returns_the_same_commit_as_get_for_an_at_event_commit", (t) => {
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    // The commits are listed once from the repo.
    const commits = listInverseCommits(repoFolder, FILE_NAME);
    // The instant is second 250, between 200 and 300.
    const selectedCommit = selectInverseCommitAtInstant(commits, makeInstant(250));
    // The selected commit is the commit of second 200, the same commit that the get function returns.
    assert.equal(selectedCommit!.text, "two\n");
    assert.equal(selectedCommit!.commitHash.toString(), getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(250))!.commitHash.toString());
});

test("test_select_returns_the_newer_before_event_commit_for_a_before_event_commit", (t) => {
    // Two before-event states are stored: second 300 holds "before-300" and second 200 holds "before-200".
    const repoFolder = makeTempFolder(t);
    makeRepo(repoFolder, FILE_NAME, "now\n", [
        makeOrderedState(1, 300, StateMoment.BeforeEvent, "before-300\n"),
        makeOrderedState(2, 200, StateMoment.BeforeEvent, "before-200\n"),
    ]);
    const commits = listInverseCommits(repoFolder, FILE_NAME);
    // The instant is exactly second 200.
    const selectedCommit = selectInverseCommitAtInstant(commits, makeInstant(200));
    // The selected commit is the newer before-event commit, the one of second 300.
    assert.equal(selectedCommit!.text, "before-300\n");
    assert.equal(selectedCommit!.moment, StateMoment.BeforeEvent);
});

test("test_select_returns_undefined_before_the_oldest_instant", (t) => {
    // Three at-event states are stored at seconds 100, 200 and 300.
    const repoFolder = makeThreeAtEventStatesRepo(t);
    const commits = listInverseCommits(repoFolder, FILE_NAME);
    // The instant is second 50, older than all of them.
    const selectedCommit = selectInverseCommitAtInstant(commits, makeInstant(50));
    // No commit is selected.
    assert.equal(selectedCommit, undefined);
});

function makeDiskNowStateWithInstant(second: number, text: string): OrderedKnownState {
    const event = { type: FileEventType.DiskNow, instant: makeInstant(second), source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
    const state: FileKnownState = { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: false, text };
    return { state, position: 0 };
}

test("test_a_time_at_or_after_the_disk_now_instant_gives_the_disk_bytes", (t) => {
    // The disk file holds "hand edit\n" with the modified time at second 200.
    const repoFolder = makeTempFolder(t);
    createInverseRepo(repoFolder, FILE_NAME, makeDiskNowStateWithInstant(200, "hand edit\n"), DISK_NOW_INSTANT);
    // An older log state holds "write text\n" at second 100.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedState(1, 100, StateMoment.AtEvent, "write text\n")]);
    // At exactly second 200 the disk bytes are given.
    assert.equal(getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(200))!.text, "hand edit\n");
    // At second 500, after the modified time, the disk bytes are given.
    assert.equal(getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(500))!.text, "hand edit\n");
});

test("test_a_time_before_the_disk_now_instant_gives_the_older_state", (t) => {
    // The disk file holds "hand edit\n" with the modified time at second 200.
    const repoFolder = makeTempFolder(t);
    createInverseRepo(repoFolder, FILE_NAME, makeDiskNowStateWithInstant(200, "hand edit\n"), DISK_NOW_INSTANT);
    // An older log state holds "write text\n" at second 100.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedState(1, 100, StateMoment.AtEvent, "write text\n")]);
    // At second 199, before the modified time, the older state is given.
    assert.equal(getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(199))!.text, "write text\n");
});

test("test_a_log_event_newer_than_the_disk_now_instant_still_gives_the_disk_bytes_after_it", (t) => {
    // The disk file holds "disk text\n" with the modified time at second 200.
    const repoFolder = makeTempFolder(t);
    createInverseRepo(repoFolder, FILE_NAME, makeDiskNowStateWithInstant(200, "disk text\n"), DISK_NOW_INSTANT);
    // A log state holds "log text\n" at second 300, newer than the modified time.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedState(1, 300, StateMoment.AtEvent, "log text\n")]);
    // At second 400 the disk bytes are given, not the log bytes.
    assert.equal(getInverseCommitAtInstant(repoFolder, FILE_NAME, makeInstant(400))!.text, "disk text\n");
});

test("test_project_function_throws_when_a_repo_folder_is_missing", (t) => {
    // The store folder is empty, so the file has no repo folder.
    const storeFolder = makeTempFolder(t);
    // Listing the states of that file throws.
    assert.throws(() => listProjectFileStatesAtInstant(storeFolder, new Path("/project"), [new Path("/project/a.txt")], makeInstant(150)));
});
