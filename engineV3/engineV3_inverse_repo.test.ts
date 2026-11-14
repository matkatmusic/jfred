import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";
import { collectGitKnownStates } from "./engineV3_replay_reverse.ts";
import {
    buildInverseRepoByEventKind, createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits,
    type OrderedKnownState,
} from "./engineV3_inverse_repo.ts";

const FILE_NAME = "a.txt";
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-inverse-repo-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInverseFolder(t: TestContext): Path {
    return new Path(makeTempFolder(t));
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function runGit(folder: Path, args: string[]): string {
    return execFileSync("git", args, { cwd: folder.toString(), encoding: "utf8", stdio: "pipe" }).trim();
}

function makeState(type: FileEventType, second: number | undefined, text: string | undefined, overrides: Partial<FileKnownState> = {}): FileKnownState {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    const event = { type, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined };
    return { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text, ...overrides };
}

function makeDiskNowState(text: string | undefined): OrderedKnownState {
    return { state: makeState(FileEventType.DiskNow, undefined, text), position: 0 };
}

function makeOlderState(position: number, text: string | undefined): OrderedKnownState {
    return { state: makeState(FileEventType.GitCommit, position * 10, text), position };
}

function getTip(inverseFolder: Path): string {
    return runGit(inverseFolder, ["rev-parse", "refs/heads/inverse"]);
}

const BYTE_DAMAGE_TEXTS: [string, string][] = [
    ["no_trailing_newline", "first line\nsecond line"],
    ["crlf_line_ends", "first line\r\nsecond line\r\n"],
    ["non_ascii_characters", "café über 日本語 \u{1f600}\n"],
];

for (const [name, text] of BYTE_DAMAGE_TEXTS) {
    test(`test_root_commit_blob_hash_equals_git_hash_object_of_disk_file_with_${name}`, (t) => {
        // Scenario: the root commit holds the exact bytes of the disk file.
        // A disk file is written with the text.
        const diskFolder = makeTempFolder(t);
        const diskFile = join(diskFolder, FILE_NAME);
        writeFileSync(diskFile, text);
        // git hashes that disk file without any filter.
        const expectedBlobHash = runGit(new Path(diskFolder), ["hash-object", "--no-filters", diskFile]);
        // The inverse repo is created from the same text.
        const inverseFolder = makeInverseFolder(t);
        createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState(text), DISK_NOW_INSTANT);
        // The blob hash of the root commit equals the hash of the disk file.
        assert.equal(runGit(inverseFolder, ["rev-parse", `refs/heads/inverse:${FILE_NAME}`]), expectedBlobHash);
    });
}

test("test_list_returns_root_commit_first_with_disk_now_and_position_zero", (t) => {
    // Scenario: a new inverse repo lists exactly one commit, the disk-now state.
    // The repo is created from a disk-now state.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    // The list has one commit.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits.length, 1);
    // That commit is the disk-now state at position 0.
    assert.equal(commits[0]!.eventType, FileEventType.DiskNow);
    assert.equal(commits[0]!.position, 0);
});

test("test_createInverseRepo_creates_a_missing_repo_folder", (t) => {
    // Scenario: the repo folder does not exist yet, two levels deep inside a temp folder.
    const missingFolder = new Path(join(makeTempFolder(t), "first-level", "second-level"));
    // Creating the inverse repo succeeds.
    createInverseRepo(missingFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    // The list has exactly one commit.
    assert.equal(listInverseCommits(missingFolder, FILE_NAME).length, 1);
});

test("test_three_older_states_make_a_chain_of_four_commits_in_position_order", (t) => {
    // Scenario: states inserted in a shuffled order end in position order, each parent being the next smaller position.
    // The repo is created and three older states are inserted in the order 2, 3, 1.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(2, "two\n"), makeOlderState(3, "three\n"), makeOlderState(1, "one\n")]);
    // There are four commits, in position order.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.deepEqual(commits.map((commit) => commit.position), [0, 1, 2, 3]);
    assert.deepEqual(commits.map((commit) => commit.text), ["now\n", "one\n", "two\n", "three\n"]);
    // Each commit has the commit of the next smaller position as its only parent.
    for (let index = 1; index < commits.length; index++) {
        const parentHash = runGit(inverseFolder, ["rev-list", "--parents", "-n", "1", commits[index]!.commitHash.toString()]).split(" ").slice(1);
        assert.deepEqual(parentHash, [commits[index - 1]!.commitHash.toString()]);
    }
});

test("test_absent_state_commit_has_the_empty_tree_and_is_file_absent", (t) => {
    // Scenario: a state where the file does not exist is a commit with the empty tree.
    // The repo is created and an absent state is inserted.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, undefined)]);
    // The second commit has the empty tree and says the file is absent.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(runGit(inverseFolder, ["rev-parse", `${commits[1]!.commitHash.toString()}^{tree}`]), EMPTY_TREE_HASH);
    assert.equal(commits[1]!.isFileAbsent, true);
    assert.equal(commits[1]!.text, undefined);
});

test("test_empty_text_state_commit_has_an_empty_blob_and_is_not_file_absent", (t) => {
    // Scenario: a file that exists with no bytes differs from an absent file.
    // The repo is created and a state with the text "" is inserted.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "")]);
    // The second commit holds the empty blob and is not absent.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits[1]!.isFileAbsent, false);
    assert.equal(commits[1]!.text, "");
    assert.equal(runGit(inverseFolder, ["rev-parse", `${commits[1]!.commitHash.toString()}:${FILE_NAME}`]), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("test_state_with_unknown_confidence_gets_no_commit_in_build_by_event_kind", (t) => {
    // Scenario: an Unknown state is a gap and has no commit.
    // The states are: disk now, a git commit, an Unknown script state, a Derived edit state.
    const states = [
        makeState(FileEventType.DiskNow, undefined, "now\n"),
        makeState(FileEventType.GitCommit, 10, "git\n"),
        makeState(FileEventType.ScriptMayWrite, 20, undefined, { confidence: StateConfidence.Unknown, isFileAbsent: false }),
        makeState(FileEventType.EditRow, 30, "edit\n", { confidence: StateConfidence.Derived }),
    ];
    // The inverse repo is built by event kind.
    const inverseFolder = makeInverseFolder(t);
    buildInverseRepoByEventKind(inverseFolder, FILE_NAME, states, DISK_NOW_INSTANT);
    // The positions with a commit are 0, 1 and 3; position 2 is a gap.
    assert.deepEqual(listInverseCommits(inverseFolder, FILE_NAME).map((commit) => commit.position), [0, 1, 3]);
});

test("test_state_between_two_commits_goes_between_them_and_later_commits_keep_tree_message_and_date", (t) => {
    // Scenario: an insert in the middle keeps the trees, messages and dates of the commits after it.
    // The repo holds positions 0, 1 and 3.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n"), makeOlderState(3, "three\n")]);
    const before = listInverseCommits(inverseFolder, FILE_NAME);
    const treesBefore = before.map((commit) => runGit(inverseFolder, ["rev-parse", `${commit.commitHash.toString()}^{tree}`]));
    const datesBefore = before.map((commit) => runGit(inverseFolder, ["log", "-1", "--format=%at %ct", commit.commitHash.toString()]));
    // Position 2 is inserted.
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(2, "two\n")]);
    const after = listInverseCommits(inverseFolder, FILE_NAME);
    // The positions are 0, 1, 2, 3.
    assert.deepEqual(after.map((commit) => commit.position), [0, 1, 2, 3]);
    // Position 3 keeps its tree, its date and its message fields.
    const treeOfThree = runGit(inverseFolder, ["rev-parse", `${after[3]!.commitHash.toString()}^{tree}`]);
    assert.equal(treeOfThree, treesBefore[2]);
    assert.equal(runGit(inverseFolder, ["log", "-1", "--format=%at %ct", after[3]!.commitHash.toString()]), datesBefore[2]);
    const { commitHash: _beforeHash, ...messageFieldsBefore } = before[2]!;
    const { commitHash: _afterHash, ...messageFieldsAfter } = after[3]!;
    assert.deepEqual(messageFieldsAfter, messageFieldsBefore);
    // Position 3 is a new commit (its parent changed); position 1 is unchanged.
    assert.notEqual(after[3]!.commitHash.toString(), before[2]!.commitHash.toString());
    assert.equal(after[1]!.commitHash.toString(), before[1]!.commitHash.toString());
});

test("test_tip_hash_is_the_same_for_build_by_event_kind_and_for_one_insert_of_all_states", (t) => {
    // Scenario: the order of the inserts does not change the commits.
    const source = { filePath: "/tmp/session.jsonl:with-colon", lineNumber: 42 };
    const states: FileKnownState[] = [
        makeState(FileEventType.DiskNow, undefined, "now\n"),
        makeState(FileEventType.EditRow, 10, "edit derived\n", { confidence: StateConfidence.Derived }),
        makeState(FileEventType.GitCommit, 20, "git\r\n", { event: { ...makeState(FileEventType.GitCommit, 20, "git\r\n").event, commitHash: new Uuid("1234567890abcdef1234567890abcdef12345678") } }),
        makeState(FileEventType.WriteRow, 30, "write\n", { event: { ...makeState(FileEventType.WriteRow, 30, "write\n").event, source } }),
        makeState(FileEventType.WriteRow, 30, undefined, { moment: StateMoment.BeforeEvent }),
        makeState(FileEventType.BackupSnapshot, 40, "backup café\n"),
        makeState(FileEventType.ScriptMayWrite, 50, undefined, { confidence: StateConfidence.Unknown, isFileAbsent: false }),
        makeState(FileEventType.ReadWhole, 60, "read\n"),
        makeState(FileEventType.ReadPartial, 70, "partial\n", { confidence: StateConfidence.Confirmed }),
        makeState(FileEventType.EditRow, 80, "edit proven\n"),
    ];
    // The first repo is built by event kind.
    const firstFolder = makeInverseFolder(t);
    const startedAt = performance.now();
    buildInverseRepoByEventKind(firstFolder, FILE_NAME, states, DISK_NOW_INSTANT);
    t.diagnostic(`buildInverseRepoByEventKind of ${states.length} states took ${Math.round(performance.now() - startedAt)} ms`);
    // The second repo gets the root and then one insert of all other known states.
    const secondFolder = makeInverseFolder(t);
    createInverseRepo(secondFolder, FILE_NAME, { state: states[0]!, position: 0 }, DISK_NOW_INSTANT);
    const otherKnownStates: OrderedKnownState[] = [];
    for (const [position, state] of states.entries()) {
        if (position > 0) {
            if (state.confidence !== StateConfidence.Unknown) {
                otherKnownStates.push({ state, position });
            }
        }
    }
    insertStatesIntoInverseRepo(secondFolder, FILE_NAME, otherKnownStates);
    // Both tips are the same commit.
    assert.equal(listInverseCommits(firstFolder, FILE_NAME).length, 9);
    assert.equal(getTip(firstFolder), getTip(secondFolder));
});

test("test_git_commit_state_blob_hash_equals_the_blob_hash_in_the_source_repo", (t) => {
    // Scenario: the text the engine reads from a git commit becomes the same blob in the inverse repo.
    // A source repo has one commit with a fixed date and a text with CRLF and non-ASCII characters.
    const sourceFolder = new Path(makeTempFolder(t));
    runGit(sourceFolder, ["init"]);
    writeFileSync(join(sourceFolder.toString(), FILE_NAME), "café\r\nno newline at end");
    const commitDate = makeInstant(500).toISOString();
    const commitEnvironment = { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate };
    runGit(sourceFolder, ["add", FILE_NAME]);
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-m", "c1"], { cwd: sourceFolder.toString(), env: commitEnvironment, stdio: "pipe" });
    const sourceCommit = runGit(sourceFolder, ["rev-parse", "HEAD"]);
    // The engine reads the commit as a string.
    const gitKnownState = collectGitKnownStates(new Path(join(sourceFolder.toString(), FILE_NAME)))[0]!;
    const state = makeState(FileEventType.GitCommit, 500, gitKnownState.content, { event: { ...makeState(FileEventType.GitCommit, 500, gitKnownState.content).event, commitHash: gitKnownState.commitHash } });
    // The inverse repo gets that state.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [{ state, position: 1 }]);
    // Its blob hash equals the blob hash of the source commit.
    const inverseCommit = listInverseCommits(inverseFolder, FILE_NAME)[1]!;
    assert.equal(runGit(inverseFolder, ["rev-parse", `${inverseCommit.commitHash.toString()}:${FILE_NAME}`]), runGit(sourceFolder, ["rev-parse", `${sourceCommit}:${FILE_NAME}`]));
});

test("test_after_an_insert_the_building_branch_is_gone_and_the_final_branch_is_the_new_tip", (t) => {
    // Scenario: the insert swaps branch B into the name of branch A.
    // The repo is created and two states are inserted.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n"), makeOlderState(2, "two\n")]);
    // Only the branch inverse exists, and it points at the commit of position 2.
    assert.equal(runGit(inverseFolder, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/inverse");
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(getTip(inverseFolder), commits[2]!.commitHash.toString());
});

test("test_inserting_a_position_that_already_has_a_commit_throws", (t) => {
    // Scenario: a position can have only one commit.
    // The repo holds position 1.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n")]);
    const tipBefore = getTip(inverseFolder);
    // Inserting position 1 again throws, and so does position 0.
    assert.throws(() => insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "again\n")]), /position 1/);
    assert.throws(() => insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(0, "root again\n")]), /position 0/);
    // The branch did not move.
    assert.equal(getTip(inverseFolder), tipBefore);
});

test("test_list_round_trips_event_type_moment_confidence_instant_absence_and_text", (t) => {
    // Scenario: what is written in a commit is read back unchanged.
    // The states differ in every field, and one instant has milliseconds.
    const withMilliseconds = new Date(makeInstant(100).getTime() + 123);
    const written: OrderedKnownState[] = [
        { state: { ...makeState(FileEventType.EditRow, 100, "edit\n", { confidence: StateConfidence.Derived, moment: StateMoment.BeforeEvent }), event: { ...makeState(FileEventType.EditRow, 100, "edit\n").event, instant: withMilliseconds } }, position: 1 },
        { state: makeState(FileEventType.BackupSnapshot, 200, undefined, { confidence: StateConfidence.Confirmed }), position: 2 },
        { state: makeState(FileEventType.ReadWhole, 300, "read café\r\n"), position: 3 },
    ];
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, written);
    // The commits read back (without the root) equal what was written.
    const readBack = listInverseCommits(inverseFolder, FILE_NAME).slice(1);
    assert.equal(readBack.length, written.length);
    for (const [index, expected] of written.entries()) {
        const actual = readBack[index]!;
        assert.equal(actual.position, expected.position);
        assert.equal(actual.eventType, expected.state.event.type);
        assert.equal(actual.moment, expected.state.moment);
        assert.equal(actual.confidence, expected.state.confidence);
        assert.equal(actual.instant!.getTime(), expected.state.event.instant!.getTime());
        assert.equal(actual.isFileAbsent, expected.state.isFileAbsent);
        assert.equal(actual.text, expected.state.text);
    }
});

const SOURCE_JSONL_PATH = "/tmp/session.jsonl";
const SOURCE_LINE_NUMBER = 42;

function makeStateWithSource(position: number): OrderedKnownState {
    const state = makeState(FileEventType.EditRow, position * 10, "edit\n");
    const source = { filePath: SOURCE_JSONL_PATH, lineNumber: SOURCE_LINE_NUMBER };
    return { state: { ...state, event: { ...state.event, source } }, position };
}

function readRawMessage(inverseFolder: Path, commitHash: string): string {
    return runGit(inverseFolder, ["log", "-1", "--format=%B", commitHash]);
}

test("test_commit_message_of_a_state_with_a_source_is_json_with_jsonlPath_line_timestamp_and_eventType", (t) => {
    // Scenario: the message of a state that came from a log line is one JSON object that names the log line.
    // The repo is created and a state with a source is inserted.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    const orderedState = makeStateWithSource(1);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [orderedState]);
    // The raw message of the second commit is a JSON object with the facts of the log line.
    const commitHash = listInverseCommits(inverseFolder, FILE_NAME)[1]!.commitHash.toString();
    const message = JSON.parse(readRawMessage(inverseFolder, commitHash));
    assert.equal(message.jsonlPath, SOURCE_JSONL_PATH);
    assert.equal(message.line, SOURCE_LINE_NUMBER);
    assert.equal(message.timestamp, orderedState.state.event.instant!.toISOString());
    assert.equal(message.eventType, FileEventType.EditRow);
});

test("test_commit_message_of_a_state_without_a_source_stores_null_for_jsonlPath_and_line", (t) => {
    // Scenario: a git commit state has no log line, so the JSON message holds null for both.
    // The repo is created and a state without a source is inserted.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n")]);
    // The raw message of the second commit has null for jsonlPath and line.
    const commitHash = listInverseCommits(inverseFolder, FILE_NAME)[1]!.commitHash.toString();
    const message = JSON.parse(readRawMessage(inverseFolder, commitHash));
    assert.equal(message.jsonlPath, null);
    assert.equal(message.line, null);
});

test("test_listInverseCommits_returns_jsonlPath_and_line", (t) => {
    // Scenario: the log file and the log line of a state come back from the list.
    // The repo holds the disk-now state, a state with a source, and a state without a source.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeStateWithSource(1), makeOlderState(2, "two\n")]);
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    // The state with a source returns both values as Path and number.
    assert.deepEqual(commits[1]!.jsonlPath, new Path(SOURCE_JSONL_PATH));
    assert.equal(commits[1]!.line, SOURCE_LINE_NUMBER);
    // The states without a source return undefined.
    assert.equal(commits[0]!.jsonlPath, undefined);
    assert.equal(commits[2]!.line, undefined);
});

test("test_a_commit_message_that_is_not_json_makes_listInverseCommits_throw", (t) => {
    // Scenario: an old-format message is not read.
    // A repo is made by hand with a root commit whose message is plain text.
    const inverseFolder = makeInverseFolder(t);
    runGit(inverseFolder, ["init", "--bare", "--initial-branch=inverse"]);
    const treeHash = execFileSync("git", ["mktree"], { cwd: inverseFolder.toString(), input: "", encoding: "utf8" }).trim();
    const commitHash = runGit(inverseFolder, ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", treeHash, "-m", "DiskNow at-event proven\n\nPosition: 0\nInstant: now\nFile-Absent: true"]);
    runGit(inverseFolder, ["update-ref", "refs/heads/inverse", commitHash]);
    // Listing the commits throws.
    assert.throws(() => listInverseCommits(inverseFolder, FILE_NAME));
});

test("test_a_commit_message_with_an_unknown_event_type_makes_listInverseCommits_throw", (t) => {
    // Scenario: an enum value that the code does not know is not read.
    // A repo is made by hand with a root commit whose JSON message has an unknown eventType.
    const inverseFolder = makeInverseFolder(t);
    runGit(inverseFolder, ["init", "--bare", "--initial-branch=inverse"]);
    const treeHash = execFileSync("git", ["mktree"], { cwd: inverseFolder.toString(), input: "", encoding: "utf8" }).trim();
    const message = JSON.stringify({ jsonlPath: null, line: null, timestamp: null, eventType: "NotAnEventType", moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, position: 0, isFileAbsent: true });
    const commitHash = runGit(inverseFolder, ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", treeHash, "-m", message]);
    runGit(inverseFolder, ["update-ref", "refs/heads/inverse", commitHash]);
    // Listing the commits throws.
    assert.throws(() => listInverseCommits(inverseFolder, FILE_NAME), /NotAnEventType/);
});

test("test_a_repo_that_grows_by_a_second_event_kind_keeps_the_json_messages_of_the_first_kind", (t) => {
    // Scenario: the copy of stored commits passes the JSON message text through unchanged.
    // The repo holds a state with a source at position 2.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeStateWithSource(2)]);
    const messageBefore = readRawMessage(inverseFolder, listInverseCommits(inverseFolder, FILE_NAME)[1]!.commitHash.toString());
    // A state of a second kind is inserted at position 1, before the first kind in the chain.
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n")]);
    // The commit at position 2 is a new commit with the same message text.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.deepEqual(commits.map((commit) => commit.position), [0, 1, 2]);
    assert.equal(readRawMessage(inverseFolder, commits[2]!.commitHash.toString()), messageBefore);
});
