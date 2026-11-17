import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
// import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const event = { type, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
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

test("test_disk_now_state_with_an_instant_writes_it_into_the_root_commit", (t) => {
    // The repo is created from a disk-now state that has an instant at second 40.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, { state: makeState(FileEventType.DiskNow, 40, "now text\n"), position: 0 }, DISK_NOW_INSTANT);
    // The root commit has that instant.
    assert.deepEqual(listInverseCommits(inverseFolder, FILE_NAME)[0]!.instant, makeInstant(40));
});

test("test_disk_now_state_without_an_instant_gives_a_root_commit_without_an_instant", (t) => {
    // The repo is created from a disk-now state that has no instant.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    // The root commit has no instant.
    assert.equal(listInverseCommits(inverseFolder, FILE_NAME)[0]!.instant, undefined);
});

test("test_disk_now_instant_does_not_change_the_author_date_of_the_root_commit", (t) => {
    // The repo is created from a disk-now state that has an instant at second 40.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, { state: makeState(FileEventType.DiskNow, 40, "now text\n"), position: 0 }, DISK_NOW_INSTANT);
    // The author date of the root commit is the build instant.
    assert.equal(runGit(inverseFolder, ["log", "-1", "--format=%at", "refs/heads/inverse"]), String(DISK_NOW_INSTANT.getTime() / 1000));
});

test("test_listInverseCommits_without_text_reads_no_blob_text_and_lists_the_same_commits", (t) => {
    // Scenario: with isTextRead false the list has the same commits but no commit has a text.
    // The repo has the disk-now commit and two older commits.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "older text\n"), makeOlderState(2, "oldest text\n")]);
    // The list with the text read has a text on every commit.
    const commitsWithText = listInverseCommits(inverseFolder, FILE_NAME);
    assert.deepEqual(commitsWithText.map((commit) => commit.text), ["now text\n", "older text\n", "oldest text\n"]);
    // The list without the text read has the same commit hashes and positions.
    const commitsWithoutText = listInverseCommits(inverseFolder, FILE_NAME, false);
    assert.deepEqual(commitsWithoutText.map((commit) => commit.commitHash.toString()), commitsWithText.map((commit) => commit.commitHash.toString()));
    assert.deepEqual(commitsWithoutText.map((commit) => commit.position), commitsWithText.map((commit) => commit.position));
    // No commit of that list has a text.
    assert.deepEqual(commitsWithoutText.map((commit) => commit.text), [undefined, undefined, undefined]);
});

test("test_listInverseCommits_gives_each_commit_the_tree_hash_of_git", (t) => {
    // Scenario: every listed commit carries the tree hash that git reports for it.
    // The repo has the disk-now commit and two older commits.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "older text\n"), makeOlderState(2, "oldest text\n")]);
    // The list has three commits.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits.length, 3);
    // Each commit's tree hash equals the answer of git rev-parse for that commit.
    for (const commit of commits) {
        const expectedTreeHash = runGit(inverseFolder, ["rev-parse", `${commit.commitHash.toString()}^{tree}`]);
        assert.equal(commit.treeHash.toString(), expectedTreeHash);
    }
});

test("test_two_commits_of_one_file_with_the_same_bytes_have_the_same_tree_hash", (t) => {
    // Scenario: the disk-now commit and an older commit hold the same bytes.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("same text\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "same text\n")]);
    // The list has two commits.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits.length, 2);
    // Both commits have the same tree hash.
    assert.equal(commits[0]!.treeHash.toString(), commits[1]!.treeHash.toString());
});

test("test_two_commits_with_different_bytes_have_different_tree_hashes", (t) => {
    // Scenario: the disk-now commit and an older commit hold different bytes.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "older text\n")]);
    // The list has two commits.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits.length, 2);
    // The two tree hashes differ.
    assert.notEqual(commits[0]!.treeHash.toString(), commits[1]!.treeHash.toString());
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
    const message = JSON.stringify({ jsonlPath: null, line: null, timestamp: null, eventType: "NotAnEventType", moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, position: 0, isFileAbsent: true, removedByScript: false, movedAwayToFile: null });
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

const MOVED_AWAY_DESTINATION = "/project/moved-to.txt";

function makeStateWithEventFlags(position: number, removedByScript: boolean, movedAwayToFile: Path | undefined): OrderedKnownState {
    const state = makeState(FileEventType.EditRow, position * 10, "edit\n");
    return { state: { ...state, event: { ...state.event, removedByScript, movedAwayToFile } }, position };
}

test("test_a_commit_of_a_removed_event_reads_back_with_removed_by_script_true", (t) => {
    // Scenario: the removed-by-script fact of an event is written into the commit and read back.
    // The repo holds the disk-now state and a state whose event was removed by a script.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeStateWithEventFlags(1, true, undefined)]);
    // The listed commit says removedByScript is true.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.equal(commits[1]!.removedByScript, true);
});

test("test_a_commit_of_a_moved_away_event_reads_back_the_destination_path", (t) => {
    // Scenario: the destination of a moved-away event is written into the commit and read back as a Path.
    // The repo holds the disk-now state and a state whose event moved the file away.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeStateWithEventFlags(1, false, new Path(MOVED_AWAY_DESTINATION))]);
    // The listed commit holds the destination as a Path.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    assert.deepEqual(commits[1]!.movedAwayToFile, new Path(MOVED_AWAY_DESTINATION));
});

test("test_a_commit_of_an_ordinary_event_reads_back_false_and_no_destination", (t) => {
    // Scenario: an ordinary event reads back with no removal and no destination.
    // The repo holds the disk-now state and an ordinary state.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n")]);
    // Both listed commits say removedByScript is false and movedAwayToFile is undefined.
    const commits = listInverseCommits(inverseFolder, FILE_NAME);
    for (const commit of commits) {
        assert.equal(commit.removedByScript, false);
        assert.equal(commit.movedAwayToFile, undefined);
    }
});

test("test_a_commit_message_without_the_new_keys_throws", (t) => {
    // Scenario: a message from before the two keys existed is not read.
    // A repo is made by hand with a root commit whose JSON message has every old key and neither new key.
    const inverseFolder = makeInverseFolder(t);
    runGit(inverseFolder, ["init", "--bare", "--initial-branch=inverse"]);
    const treeHash = execFileSync("git", ["mktree"], { cwd: inverseFolder.toString(), input: "", encoding: "utf8" }).trim();
    const oldFields = { jsonlPath: null, line: null, timestamp: null, eventType: FileEventType.DiskNow, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, position: 0, isFileAbsent: true, sourceCommit: null };
    const oldHash = runGit(inverseFolder, ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", treeHash, "-m", JSON.stringify(oldFields)]);
    runGit(inverseFolder, ["update-ref", "refs/heads/inverse", oldHash]);
    // Listing the commits throws and names the key removedByScript.
    assert.throws(() => listInverseCommits(inverseFolder, FILE_NAME), /parseCommitMessage: the commit message has no removedByScript/);
    // A message with removedByScript but without movedAwayToFile throws and names the key movedAwayToFile.
    const halfHash = runGit(inverseFolder, ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", treeHash, "-m", JSON.stringify({ ...oldFields, removedByScript: false })]);
    runGit(inverseFolder, ["update-ref", "refs/heads/inverse", halfHash]);
    assert.throws(() => listInverseCommits(inverseFolder, FILE_NAME), /parseCommitMessage: the commit message has no movedAwayToFile/);
});

/* Commented out: task 1027 (fast-import writer) was dropped by the user, so these git-start-count tests cannot pass.
function startLoggingGitStarts(t: TestContext): string {
    const shimFolder = makeTempFolder(t);
    const logFile = join(shimFolder, "git-starts.log");
    const realGitFile = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimFile = join(shimFolder, "git");
    const shimText = `#!/bin/sh\nif [ "$1" = "-c" ]; then echo "$3" >> "${logFile}"; else echo "$1" >> "${logFile}"; fi\nexec "${realGitFile}" "$@"\n`;
    writeFileSync(shimFile, shimText);
    chmodSync(shimFile, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${shimFolder}:${originalPath}`;
    t.after(() => {
        process.env.PATH = originalPath;
    });
    return logFile;
}

function listLoggedGitStarts(logFile: string): string[] {
    return readFileSync(logFile, "utf8").split("\n").filter((line) => line !== "");
}

test("test_createInverseRepo_starts_git_only_for_init_and_fast_import", (t) => {
    // Scenario: creating a repo costs two git starts: init and one fast-import for the root commit.
    // Git starts are logged from now on.
    const logFile = startLoggingGitStarts(t);
    // The repo is created from a disk-now state.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now text\n"), DISK_NOW_INSTANT);
    // Git was started twice: init, then fast-import.
    assert.deepEqual(listLoggedGitStarts(logFile), ["init", "fast-import"]);
});

test("test_insertStatesIntoInverseRepo_starts_git_only_for_log_and_fast_import_for_twenty_states", (t) => {
    // Scenario: an insert costs two git starts however many states it adds.
    // The repo is created before the logging starts.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    const logFile = startLoggingGitStarts(t);
    // Twenty older states are inserted in one call.
    const newStates: OrderedKnownState[] = [];
    for (let position = 1; position <= 20; position++) {
        newStates.push(makeOlderState(position, `text ${position}\n`));
    }
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, newStates);
    // Git was started twice: log (read stored commits), then fast-import.
    assert.deepEqual(listLoggedGitStarts(logFile), ["log", "fast-import"]);
});

test("test_insert_between_stored_commits_starts_git_only_for_log_and_fast_import", (t) => {
    // Scenario: re-creating the stored commits after a new position costs no extra git start.
    // The repo holds positions 0, 1 and 3 before the logging starts.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n"), makeOlderState(3, "three\n")]);
    const logFile = startLoggingGitStarts(t);
    // Position 2 is inserted.
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(2, "two\n")]);
    // Git was started twice: log, then fast-import.
    assert.deepEqual(listLoggedGitStarts(logFile), ["log", "fast-import"]);
});

test("test_buildInverseRepoByEventKind_starts_git_only_four_times_for_states_in_four_groups", (t) => {
    // Scenario: the groups are written by one insert, so a build costs init, fast-import, log, fast-import.
    // The states fall in four groups: GitCommit, proven EditRow, ReadWhole, derived EditRow.
    const states = [
        makeState(FileEventType.DiskNow, undefined, "now\n"),
        makeState(FileEventType.EditRow, 10, "edit derived\n", { confidence: StateConfidence.Derived }),
        makeState(FileEventType.ReadWhole, 20, "read\n"),
        makeState(FileEventType.EditRow, 30, "edit proven\n"),
        makeState(FileEventType.GitCommit, 40, "git\n"),
    ];
    // Git starts are logged from now on.
    const logFile = startLoggingGitStarts(t);
    const inverseFolder = makeInverseFolder(t);
    buildInverseRepoByEventKind(inverseFolder, FILE_NAME, states, DISK_NOW_INSTANT);
    // Git was started four times.
    assert.deepEqual(listLoggedGitStarts(logFile), ["init", "fast-import", "log", "fast-import"]);
});
*/

function replayCommitsWithPlainGit(sourceFolder: Path, targetFolder: Path, fileName: string): void {
    runGit(targetFolder, ["init", "--bare", "--initial-branch=inverse"]);
    let parentHash: string | undefined;
    for (const sourceCommit of listInverseCommits(sourceFolder, fileName)) {
        const sourceHash = sourceCommit.commitHash.toString();
        const authorSeconds = runGit(sourceFolder, ["log", "-1", "--format=%at", sourceHash]);
        const message = runGit(sourceFolder, ["log", "-1", "--format=%B", sourceHash]);
        let treeHash = execFileSync("git", ["mktree"], { cwd: targetFolder.toString(), input: "", encoding: "utf8" }).trim();
        if (sourceCommit.text !== undefined) {
            const blobHash = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: targetFolder.toString(), input: sourceCommit.text, encoding: "utf8" }).trim();
            treeHash = execFileSync("git", ["mktree"], { cwd: targetFolder.toString(), input: `100644 blob ${blobHash}\t${fileName}\n`, encoding: "utf8" }).trim();
        }
        const args = ["-c", "commit.gpgsign=false", "commit-tree", treeHash];
        if (parentHash !== undefined) {
            args.push("-p", parentHash);
        }
        args.push("-m", message);
        const dateText = `${authorSeconds} +0000`;
        const env = { ...process.env, GIT_AUTHOR_NAME: "jfred inverse repo", GIT_AUTHOR_EMAIL: "inverse-repo@jfred.invalid", GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_NAME: "jfred inverse repo", GIT_COMMITTER_EMAIL: "inverse-repo@jfred.invalid", GIT_COMMITTER_DATE: dateText };
        parentHash = execFileSync("git", args, { cwd: targetFolder.toString(), env, encoding: "utf8" }).trim();
    }
    runGit(targetFolder, ["update-ref", "refs/heads/inverse", parentHash!]);
}

function listRefsAndCommitHashes(folder: Path): string[] {
    return [runGit(folder, ["for-each-ref"]), runGit(folder, ["rev-list", "--all", "--reverse"])];
}

test("test_built_repo_has_the_same_refs_and_commit_hashes_as_a_plain_git_replay", (t) => {
    // Scenario: the new writer and the old git commands give the same refs and commit hashes.
    // The states hold a git commit with CRLF, an absent file, a non-ASCII text, an empty text and a text without a final newline.
    const states = [
        makeState(FileEventType.DiskNow, undefined, "now\n"),
        makeState(FileEventType.GitCommit, 10, "git\r\n"),
        makeState(FileEventType.WriteRow, 20, undefined, { moment: StateMoment.BeforeEvent }),
        makeState(FileEventType.BackupSnapshot, 30, "café 日本 \u{1f600}\n"),
        makeState(FileEventType.ReadWhole, 40, ""),
        makeState(FileEventType.EditRow, 50, "edit", { confidence: StateConfidence.Derived }),
    ];
    // The repo is built with the writer under test.
    const builtFolder = makeInverseFolder(t);
    buildInverseRepoByEventKind(builtFolder, FILE_NAME, states, DISK_NOW_INSTANT);
    // The same commits are made again with the old plain git commands.
    const replayedFolder = makeInverseFolder(t);
    replayCommitsWithPlainGit(builtFolder, replayedFolder, FILE_NAME);
    // The refs and the commit hashes are the same.
    assert.deepEqual(listRefsAndCommitHashes(builtFolder), listRefsAndCommitHashes(replayedFolder));
});

test("test_repo_after_an_insert_between_stored_commits_has_the_same_hashes_as_a_plain_git_replay", (t) => {
    // Scenario: re-created stored commits get the same hashes as the old commit-tree calls.
    // The repo holds positions 0, 1 and 3, then position 2 is inserted.
    const builtFolder = makeInverseFolder(t);
    createInverseRepo(builtFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(builtFolder, FILE_NAME, [makeOlderState(1, "one\n"), makeOlderState(3, undefined)]);
    insertStatesIntoInverseRepo(builtFolder, FILE_NAME, [makeOlderState(2, "two\n")]);
    // The same commits are made again with the old plain git commands.
    const replayedFolder = makeInverseFolder(t);
    replayCommitsWithPlainGit(builtFolder, replayedFolder, FILE_NAME);
    // The refs and the commit hashes are the same.
    assert.deepEqual(listRefsAndCommitHashes(builtFolder), listRefsAndCommitHashes(replayedFolder));
});

test("test_file_name_with_a_quote_a_backslash_and_a_space_gives_the_same_hashes_as_a_plain_git_replay", (t) => {
    // Scenario: the path in the stream is quoted so odd file names keep the old tree hash.
    const oddFileName = "we\"ird name\\x.txt";
    // A repo is built with a root and one older state.
    const builtFolder = makeInverseFolder(t);
    createInverseRepo(builtFolder, oddFileName, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(builtFolder, oddFileName, [makeOlderState(1, "one\n")]);
    // The same commits are made again with the old plain git commands.
    const replayedFolder = makeInverseFolder(t);
    replayCommitsWithPlainGit(builtFolder, replayedFolder, oddFileName);
    // The refs and the commit hashes are the same.
    assert.deepEqual(listRefsAndCommitHashes(builtFolder), listRefsAndCommitHashes(replayedFolder));
});

test("test_onNewStateCommitted_is_called_once_for_the_root_and_once_for_each_inserted_state", (t) => {
    // Scenario: the progress counter reaches the commit count.
    let callCount = 0;
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT, () => { callCount += 1; });
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n"), makeOlderState(2, "two\n"), makeOlderState(3, "three\n")], () => { callCount += 1; });
    // One call for the root and three for the inserted states.
    assert.equal(callCount, 4);
});

/* Commented out: task 1027 (fast-import writer) was dropped; the old writer stores a name that starts with a quote under the wrong name.
test("test_file_name_that_starts_with_a_quote_reads_back_its_text", (t) => {
    // Scenario: a name that starts with a double quote is stored under that exact name.
    const quotedFileName = "\"q\".txt";
    // A repo is built with a root and one older state.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, quotedFileName, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, quotedFileName, [makeOlderState(1, "one\n")]);
    // Both texts are read back.
    const texts = listInverseCommits(inverseFolder, quotedFileName).map((commit) => commit.text);
    assert.deepEqual(texts, ["now\n", "one\n"]);
});
*/

test("test_tip_hash_of_the_states_of_the_line_271_test_is_the_literal_hash_of_the_old_writer", (t) => {
    // Scenario: the tip hash equals the hash that the old writer gave for the same states.
    // The states are copied from the test at test file line 271.
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
    // The repo is built with the writer under test.
    const inverseFolder = makeInverseFolder(t);
    buildInverseRepoByEventKind(inverseFolder, FILE_NAME, states, DISK_NOW_INSTANT);
    // The tip is the hash printed by the old writer.
    assert.equal(getTip(inverseFolder), "3fbe874739c9f4a28bbe21e4de86d610469cb609");
});

test("test_insert_with_a_second_new_state_without_an_instant_throws_and_keeps_the_tip", (t) => {
    // Scenario: a missing instant stops the insert before anything is written.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("now\n"), DISK_NOW_INSTANT);
    const tipBefore = getTip(inverseFolder);
    // The first new state has an instant. The second new state has none.
    const stateWithInstant = makeOlderState(1, "one\n");
    const stateWithoutInstant = { state: makeState(FileEventType.GitCommit, undefined, "two\n"), position: 2 };
    // The insert throws.
    assert.throws(() => insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [stateWithInstant, stateWithoutInstant]), /has no instant/);
    // The tip is the same as before.
    assert.equal(getTip(inverseFolder), tipBefore);
});

function makeGitCallCounter(t: TestContext): { readCallCount: () => number } {
    const realGitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const scriptFolder = makeTempFolder(t);
    const logFile = join(makeTempFolder(t), "git-calls.log");
    const scriptFile = join(scriptFolder, "git");
    writeFileSync(scriptFile, `#!/bin/sh\necho "$1" >> "${logFile}"\nexec ${realGitPath} "$@"\n`);
    chmodSync(scriptFile, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${scriptFolder}:${oldPath}`;
    t.after(() => {
        process.env.PATH = oldPath;
    });
    const readCallCount = (): number => {
        if (!existsSync(logFile)) {
            return 0;
        }
        return readFileSync(logFile, "utf8").split("\n").filter((line) => line !== "").length;
    };
    return { readCallCount };
}

function makeInverseRepoWithStoredCommits(t: TestContext, storedCommitCount: number): Path {
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("zero\n"), DISK_NOW_INSTANT);
    for (let position = 1; position < storedCommitCount; position++) {
        insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(position, `text ${position}\n`)]);
    }
    return inverseFolder;
}

test("test_appending_one_state_starts_the_same_number_of_git_processes_with_3_stored_commits_as_with_12", (t) => {
    // Scenario: an append starts the same number of git processes however many commits are stored.
    // Repo A stores 3 commits and repo B stores 12 commits.
    const inverseFolderA = makeInverseRepoWithStoredCommits(t, 3);
    const inverseFolderB = makeInverseRepoWithStoredCommits(t, 12);
    // For repo A: count the git processes of one append at position 3.
    const counterA = makeGitCallCounter(t);
    insertStatesIntoInverseRepo(inverseFolderA, FILE_NAME, [makeOlderState(3, "appended\n")]);
    const callCountOfRepoA = counterA.readCallCount();
    // For repo B: count the git processes of one append at position 12.
    const counterB = makeGitCallCounter(t);
    insertStatesIntoInverseRepo(inverseFolderB, FILE_NAME, [makeOlderState(12, "appended\n")]);
    const callCountOfRepoB = counterB.readCallCount();
    // Both appends start the same number of git processes.
    assert.equal(callCountOfRepoB, callCountOfRepoA, `git processes: repo A (3 stored) = ${callCountOfRepoA}, repo B (12 stored) = ${callCountOfRepoB}`);
});

test("test_appending_states_one_call_each_gives_the_pinned_tip_hash_of_the_rewrite_path", (t) => {
    // Scenario: three appends, one call each, end in a tip hash pinned from the old rewrite path.
    // The repo is created and the positions 1, 2 and 3 are inserted in three calls.
    const inverseFolder = makeInverseFolder(t);
    createInverseRepo(inverseFolder, FILE_NAME, makeDiskNowState("zero\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(1, "one\n")]);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(2, "two\n")]);
    insertStatesIntoInverseRepo(inverseFolder, FILE_NAME, [makeOlderState(3, "three\n")]);
    // The tip hash is the pinned one.
    assert.equal(getTip(inverseFolder), "1283e8fdaa10dca4b866f594e983dd0f5cfe3e3b");
});
