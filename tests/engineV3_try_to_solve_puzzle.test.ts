import { test } from "node:test";
import assert from "node:assert/strict";

import { Path, Uuid } from "../src/structures/domain.ts";
import { PuzzleFailureReason, ToolName } from "../src/structures/vocabulary.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { EditRow } from "../engineV3/engineV3_replay_reverse.ts";
import { ABSENT_FILE_HASH, computeBytesHash, isProgressBarPuzzleSolved, type OnDiskFile } from "../engineV3/engineV3_puzzle_types.ts";
import { buildProgressBarPuzzleForFile, tryToSolveProgressBarPuzzle, type ForwardReplay } from "../engineV3/tryToSolvePuzzle.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runGit(folder: string, gitArguments: string[]): string {
    return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...gitArguments], { cwd: folder, encoding: "utf8" }).trim();
}

// A repo with one start commit that holds start.txt; the folders for logs and snapshots are empty.
function makeRepoWithStartCommit(): { repoFolder: string; startCommit: string; emptyFolder: Path } {
    const repoFolder = realpathSync(mkdtempSync(join(tmpdir(), "solve-one-")));
    runGit(repoFolder, ["init", "-q"]);
    writeFileSync(join(repoFolder, "start.txt"), TEXT_START);
    runGit(repoFolder, ["add", "--", "start.txt"]);
    runGit(repoFolder, ["commit", "-q", "-m", "start"]);
    const emptyFolder = realpathSync(mkdtempSync(join(tmpdir(), "solve-one-empty-")));
    return { repoFolder, startCommit: runGit(repoFolder, ["rev-parse", "HEAD"]), emptyFolder: new Path(emptyFolder) };
}

const GIT_REPO = new Path("/repo/jot.git");
const LOG_FILE = "/logs/a.jsonl";
const TEXT_START = "one two three";
const TEXT_AFTER_EDIT = "one TWO three";

function makeOnDiskFile(textNow: string): OnDiskFile {
    return { file: new Path("/project/a.txt"), hashNow: computeBytesHash(textNow) };
}

function makeEvent(type: FileEventType, lineNumber: number | undefined, fields: Partial<FileEvent> = {}): FileEvent {
    let source: FileEvent["source"];
    if (lineNumber !== undefined) {
        source = { filePath: LOG_FILE, lineNumber };
    }
    return { type, instant: new Date(Date.UTC(2026, 0, 1, 0, 0, lineNumber ?? 0)), source, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined, ...fields };
}

function makeGitCommitEvent(text: string): FileEvent {
    return makeEvent(FileEventType.GitCommit, undefined, { commitHash: new Uuid("abc123"), bytes: text });
}

function makeEditEvent(lineNumber: number, oldString: string, newString: string, replaceAll: boolean = false): FileEvent {
    const row: EditRow = { toolName: ToolName.Edit, timestamp: new Date(), source: undefined, oldString, newString, replaceAll, originalFile: undefined };
    return makeEvent(FileEventType.EditRow, lineNumber, { row });
}

function makeWriteEvent(lineNumber: number, text: string): FileEvent {
    return makeEvent(FileEventType.WriteRow, lineNumber, { row: { toolName: ToolName.Write, timestamp: new Date(), source: undefined, isCreate: false, content: text, originalFile: undefined } });
}

test("test_a_beacon_then_an_exact_edit_solves_the_puzzle", () => {
    // Scenario: the start commit holds "one two three"; one Edit changes "two" to "TWO"; the file on disk now is "one TWO three".
    const events = [makeGitCommitEvent(TEXT_START), makeEditEvent(5, "two", "TWO")];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    // The bytes at the end equal the file now, so the puzzle is solved and has no failure reason.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.equal(puzzle.failureReason, undefined);
    // The hops are the git commit, then the log line of the Edit.
    assert.deepEqual(puzzle.hops, [{ gitHop: { repo: GIT_REPO, commit: "abc123" } }, { jsonlHop: { jsonlFile: new Path(LOG_FILE), lineNumber: 5 } }]);
});

test("test_an_edit_whose_old_text_is_missing_fails_with_edit_old_text_not_found", () => {
    // Scenario: the Edit looks for "absent", which is not in the bytes.
    const events = [makeGitCommitEvent(TEXT_START), makeEditEvent(5, "absent", "x")];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    // The failure names the Edit's log line.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.EditOldTextNotFound);
    assert.deepEqual(puzzle.lastAttemptedHop, { jsonlFile: new Path(LOG_FILE), lineNumber: 5 });
});

test("test_an_edit_whose_old_text_occurs_twice_fails_with_edit_old_text_found_many_times", () => {
    // Scenario: "o" occurs twice in "one two three" ("one", "two"), and replaceAll is off.
    const events = [makeGitCommitEvent(TEXT_START), makeEditEvent(5, "o", "0")];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    // The Edit is a guess, so the puzzle stops.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.EditOldTextFoundManyTimes);
});

test("test_a_replace_all_edit_replaces_every_occurrence", () => {
    // Scenario: replaceAll is on and "e" occurs in "one two three" four times.
    const events = [makeGitCommitEvent(TEXT_START), makeEditEvent(5, "e", "E", true)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile("onE two thrEE"), events, GIT_REPO);
    // All occurrences changed and the puzzle is solved.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
});

test("test_a_script_that_may_write_fails_with_script_may_write", () => {
    // Scenario: a beacon, then a script that may write the file.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), events, GIT_REPO);
    // The script run is never replayed here, so the puzzle fails at the script's log line.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.ScriptMayWrite);
    assert.deepEqual(puzzle.lastAttemptedHop, { jsonlFile: new Path(LOG_FILE), lineNumber: 7 });
});

test("test_a_user_edit_notice_fails_with_user_edit_notice", () => {
    // Scenario: a beacon, then a notice that the user changed the file by hand.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.UserEditNotice, 7)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), events, GIT_REPO);
    // The user's change is not known, so the puzzle fails.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.UserEditNotice);
});

test("test_a_partial_read_changes_nothing", () => {
    // Scenario: a beacon, then a partial read; the file now equals the beacon.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ReadPartial, 7)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), events, GIT_REPO);
    // The puzzle is solved, and the read is not a hop.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.equal(puzzle.hops.length, 1);
});

test("test_a_later_beacon_closes_a_gap_so_the_puzzle_is_solved", () => {
    // Scenario: a beacon, a script that may write, then a Write of the whole file.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7), makeWriteEvent(9, TEXT_AFTER_EDIT)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    // A gap in the middle is allowed, so the puzzle is solved with no failure reason.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.equal(puzzle.failureReason, undefined);
});

test("test_an_edit_inside_a_gap_is_not_a_hop", () => {
    // Scenario: a script that may write comes first and an Edit comes after it, with no beacon between.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7), makeEditEvent(9, "two", "TWO")];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    // The first failure stays the failure; the Edit is not tried.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.ScriptMayWrite);
    assert.deepEqual(puzzle.hops, [{ gitHop: { repo: GIT_REPO, commit: "abc123" } }]);
});

test("test_bytes_that_differ_from_the_file_now_fail_with_final_hash_mismatch", () => {
    // Scenario: every step applies, but the file now is something else.
    const events = [makeGitCommitEvent(TEXT_START)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile("something else"), events, GIT_REPO);
    // The final hashes differ.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.FinalHashMismatch);
});

test("test_a_disk_now_event_is_not_used_as_a_beacon", () => {
    // Scenario: the only event is the disk now event, which holds the file now.
    const events = [makeEvent(FileEventType.DiskNow, undefined, { bytes: TEXT_START })];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), events, GIT_REPO);
    // The disk is the target, not an input, so no event is left.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.NoEvents);
});

test("test_a_file_missing_at_the_start_commit_fails_with_born_after_start", () => {
    // Scenario: the start commit holds only start.txt; born.txt is on disk now.
    const { repoFolder, startCommit, emptyFolder } = makeRepoWithStartCommit();
    writeFileSync(join(repoFolder, "born.txt"), "new");
    const onDiskFile: OnDiskFile = { file: new Path(join(repoFolder, "born.txt")), hashNow: computeBytesHash("new") };
    const puzzle = tryToSolveProgressBarPuzzle(onDiskFile, [emptyFolder], new Path(repoFolder), startCommit, [emptyFolder]);
    // A file born after the start commit requires further research.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.BornAfterStart);
});

test("test_a_file_unchanged_since_the_start_commit_is_solved_by_the_start_beacon_alone", () => {
    // Scenario: start.txt is in the start commit and still has the same text on disk; no log names it.
    const { repoFolder, startCommit, emptyFolder } = makeRepoWithStartCommit();
    const onDiskFile: OnDiskFile = { file: new Path(join(repoFolder, "start.txt")), hashNow: computeBytesHash(TEXT_START) };
    const puzzle = tryToSolveProgressBarPuzzle(onDiskFile, [emptyFolder], new Path(repoFolder), startCommit, [emptyFolder]);
    // The only hop is the git commit.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.deepEqual(puzzle.hops, [{ gitHop: { repo: new Path(repoFolder), commit: startCommit } }]);
});

function makeMoveEvent(lineNumber: number, oldPath: string): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, lineNumber, { moveOrCopySourceFile: new Path(oldPath) });
}

function makeOriginReplay(bytes: string | undefined): ForwardReplay {
    let pendingFailure: ForwardReplay["pendingFailure"];
    if (bytes === undefined) {
        pendingFailure = { reason: PuzzleFailureReason.BornAfterStart, detail: undefined, hop: undefined };
    }
    return { hops: [{ gitHop: { repo: GIT_REPO, commit: "origin1" } }], bytes, isAbsent: false, pendingFailure, lastAttemptedHop: undefined };
}

test("test_a_move_event_takes_the_bytes_of_the_old_path_at_the_move_time", () => {
    // Scenario: a script moved old.txt onto the file; old.txt held "origin text" just before the move.
    const askedMoves: string[] = [];
    const resolveMoveOrigin = (oldPath: Path, movedAt: Date): ForwardReplay => {
        askedMoves.push(`${oldPath.toString()}@${movedAt.toISOString()}`);
        return makeOriginReplay("origin text");
    };
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile("origin text"), [makeMoveEvent(7, "/project/old.txt")], GIT_REPO, resolveMoveOrigin);
    // The old path was asked at the instant of the move.
    assert.deepEqual(askedMoves, ["/project/old.txt@2026-01-01T00:00:07.000Z"]);
    // The puzzle is solved, and the hops are the old path's hops, then the move's log line.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.deepEqual(puzzle.hops, [{ gitHop: { repo: GIT_REPO, commit: "origin1" } }, { jsonlHop: { jsonlFile: new Path(LOG_FILE), lineNumber: 7 } }]);
});

test("test_a_later_edit_applies_to_the_bytes_taken_from_the_old_path", () => {
    // Scenario: a move brings "one two three", then an Edit changes "two" to "TWO".
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), [makeMoveEvent(7, "/project/old.txt"), makeEditEvent(9, "two", "TWO")], GIT_REPO, () => makeOriginReplay(TEXT_START));
    // The Edit applied to the moved bytes.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
});

test("test_a_move_whose_old_path_cannot_be_replayed_fails_with_the_failure_of_the_old_path", () => {
    // Scenario: the old path was born after the start commit, so its bytes are unknown.
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), [makeMoveEvent(7, "/project/old.txt")], GIT_REPO, () => makeOriginReplay(undefined));
    // The failure of the old path is the failure of the file.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.BornAfterStart);
    assert.deepEqual(puzzle.hops, []);
});

test("test_a_script_that_removes_the_file_leaves_it_absent", () => {
    // Scenario: a beacon, then a script that removes the file; the file is not on disk now.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7, { removedByScript: true })];
    const puzzle = buildProgressBarPuzzleForFile({ file: new Path("/project/a.txt"), hashNow: ABSENT_FILE_HASH }, events, GIT_REPO);
    // The replay ends with the file absent, so the puzzle is solved.
    assert.equal(puzzle.isFileAbsentAtEnd, true);
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
});

test("test_a_git_commit_that_deletes_the_file_leaves_it_absent", () => {
    // Scenario: a beacon, then a git commit with no bytes (the file is deleted in that commit).
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.GitCommit, undefined, { commitHash: new Uuid("def456") })];
    const puzzle = buildProgressBarPuzzleForFile({ file: new Path("/project/a.txt"), hashNow: ABSENT_FILE_HASH }, events, GIT_REPO);
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.deepEqual(puzzle.hops[1], { gitHop: { repo: GIT_REPO, commit: "def456" } });
});

test("test_an_absent_end_with_a_file_on_disk_now_fails_with_final_hash_mismatch", () => {
    // Scenario: the replay ends absent, but the file is on disk now.
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7, { removedByScript: true })];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), events, GIT_REPO);
    assert.equal(puzzle.failureReason, PuzzleFailureReason.FinalHashMismatch);
});

test("test_a_write_after_a_removal_makes_the_file_exist_again", () => {
    // Scenario: beacon, removal, then a Write of "one TWO three".
    const events = [makeGitCommitEvent(TEXT_START), makeEvent(FileEventType.ScriptMayWrite, 7, { removedByScript: true }), makeWriteEvent(9, TEXT_AFTER_EDIT)];
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_AFTER_EDIT), events, GIT_REPO);
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.equal(puzzle.isFileAbsentAtEnd, false);
});

// Commits one file change in the repo and returns the full hash; removeFile true deletes the file instead.
function commitFileChange(repoFolder: string, name: string, text: string | undefined): string {
    if (text === undefined) {
        runGit(repoFolder, ["rm", "-q", "--", name]);
    } else {
        writeFileSync(join(repoFolder, name), text);
        runGit(repoFolder, ["add", "--", name]);
    }
    runGit(repoFolder, ["commit", "-q", "-m", `change ${name}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

test("test_the_start_beacon_is_the_creation_commit_of_the_file_and_later_commits_are_beacons", () => {
    // Scenario: c1 creates f.txt, c2 changes it, c3 (the start commit) adds another file; f.txt on disk holds the c2 text.
    const { repoFolder, emptyFolder } = makeRepoWithStartCommit();
    const creationCommit = commitFileChange(repoFolder, "f.txt", "v1");
    const changeCommit = commitFileChange(repoFolder, "f.txt", "v2");
    const startCommit = commitFileChange(repoFolder, "other.txt", "x");
    const onDiskFile: OnDiskFile = { file: new Path(join(repoFolder, "f.txt")), hashNow: computeBytesHash("v2") };
    const puzzle = tryToSolveProgressBarPuzzle(onDiskFile, [emptyFolder], new Path(repoFolder), startCommit, [emptyFolder]);
    // The hops are the creation commit and the change commit, though both are older than the start commit.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.deepEqual(puzzle.hops, [{ gitHop: { repo: new Path(repoFolder), commit: creationCommit } }, { gitHop: { repo: new Path(repoFolder), commit: changeCommit } }]);
});

test("test_a_commit_after_the_start_that_deletes_the_file_solves_an_absent_file", () => {
    // Scenario: f.txt exists at the start commit; a later commit deletes it; it is not on disk now.
    const { repoFolder, emptyFolder } = makeRepoWithStartCommit();
    const creationCommit = commitFileChange(repoFolder, "f.txt", "v1");
    const startCommit = creationCommit;
    const deleteCommit = commitFileChange(repoFolder, "f.txt", undefined);
    const onDiskFile: OnDiskFile = { file: new Path(join(repoFolder, "f.txt")), hashNow: ABSENT_FILE_HASH };
    const puzzle = tryToSolveProgressBarPuzzle(onDiskFile, [emptyFolder], new Path(repoFolder), startCommit, [emptyFolder]);
    // The replay ends absent through the delete commit.
    assert.equal(isProgressBarPuzzleSolved(puzzle), true);
    assert.deepEqual(puzzle.hops.map((hop) => hop.gitHop!.commit), [creationCommit, deleteCommit]);
});

test("test_no_events_fails_with_no_events", () => {
    // Scenario: no event names the file.
    const puzzle = buildProgressBarPuzzleForFile(makeOnDiskFile(TEXT_START), [], GIT_REPO);
    // The puzzle has no hop to attempt.
    assert.equal(puzzle.failureReason, PuzzleFailureReason.NoEvents);
    assert.equal(puzzle.lastAttemptedHop, undefined);
});
