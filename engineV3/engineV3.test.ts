import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHECKOUT_FOLDER_PREFIX, runReplay, checkOutRepoAt, applyCommitToState, getChildCommitTowards, isCommitAtOrBefore, applyJSONLLineToState, getJSONLLineKind, JSONLLineKind, createGitCommitForRange, TimelineEventKind, TimelineEvent, JSONLAndGitEvents, CommitHash, JSONLLine } from "./engineV3.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { RepoState, findRepoStateDifferences, isRepoStateEqual } from "../src/engine_v3_repo_state.ts";

function assertRepoStatesEqual(expected: RepoState, actual: RepoState): void {
    const differences = findRepoStateDifferences(expected, actual);
    assert.ok(isRepoStateEqual(expected, actual), JSON.stringify(differences));
}

test("replay commits", () => {
    // use the typesafe-playground folder for 'repo' use the initial commit of typesafe-playground for 'startingCommit'
    const repo: Path = new Path("/Users/matkatmusicllc/Programming/typesafe-playground/");
    const startingCommit: CommitHash = new Uuid("6510b84e43da6059a657e75fe091c5d334fcb299");
    let repoState = checkOutRepoAt(repo, startingCommit);
    // use the 1st child commit of typesafe-playground for 'endingCommit'
    const endingCommit: CommitHash = new Uuid("cb136ca199e7b68336c80ae929ecbc2d9dd6e6f4");
    const targetState = checkOutRepoAt(repo, endingCommit);
    const snapshotPaths: Path[] = []; // Add snapshot paths if needed
    const jsonlLines: JSONLLine[] = []; // Add JSONL lines if needed
    const currentState = runReplay(repoState, startingCommit, endingCommit, repo, snapshotPaths, jsonlLines);
    // only check git-tracked files for now.
    assertRepoStatesEqual(targetState, currentState);
});

type ThreeCommitRepo = { repo: Path; commitA: CommitHash; commitB: CommitHash; commitC: CommitHash };

function runGit(repo: Path, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    return execFileSync("git", gitArgs, { cwd: repo.toString(), encoding: "utf8" }).trim();
}

function commitFiles(repo: Path, message: string, files: Array<[string, string]>, deletedFiles: string[]): CommitHash {
    for (const [name, content] of files) {
        writeFileSync(join(repo.toString(), name), content);
    }
    for (const name of deletedFiles) {
        rmSync(join(repo.toString(), name));
    }
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["commit", "-q", "-m", message]);
    return new Uuid(runGit(repo, ["rev-parse", "HEAD"]));
}

// A: keep, change, gone. B: adds added, changes change. C: deletes gone.
function makeThreeCommitRepo(t: TestContext): ThreeCommitRepo {
    const repoFolder = mkdtempSync(join(tmpdir(), "engine-v3-replay-"));
    t.after(() => rmSync(repoFolder, { recursive: true, force: true }));
    const repo = new Path(repoFolder);
    runGit(repo, ["init", "-q"]);
    const commitA = commitFiles(repo, "A", [["keep.txt", "keep"], ["change.txt", "old"], ["gone.txt", "gone"]], []);
    const commitB = commitFiles(repo, "B", [["added.txt", "added"], ["change.txt", "new"]], []);
    const commitC = commitFiles(repo, "C", [], ["gone.txt"]);
    return { repo, commitA, commitB, commitC };
}

function listCheckoutFolders(): string[] {
    const names = readdirSync(tmpdir());
    const checkoutFolders: string[] = [];
    for (const name of names) {
        const isCheckoutFolder = name.startsWith(CHECKOUT_FOLDER_PREFIX);
        if (isCheckoutFolder) {
            checkoutFolders.push(name);
        }
    }
    return checkoutFolders;
}

test("test_checkOutRepoAt_leaves_no_temp_folder_behind", (t) => {
    // Scenario: the number of checkout folders in the temp folder is the same before and after a checkout.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const foldersBefore = listCheckoutFolders();
    checkOutRepoAt(repo, commitA);
    assert.deepEqual(listCheckoutFolders(), foldersBefore);
});

test("test_applyCommitToState_leaves_state_at_the_commit_unchanged", (t) => {
    // Scenario: applying commit A to a state already at A changes nothing.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = applyCommitToState(commitA, checkOutRepoAt(repo, commitA), repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitA), state);
});

test("test_applyCommitToState_adds_and_changes_files_of_the_commit", (t) => {
    // Scenario: applying B to the state at A gives the same state as checking out B.
    const { repo, commitA, commitB } = makeThreeCommitRepo(t);
    const state = applyCommitToState(commitB, checkOutRepoAt(repo, commitA), repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitB), state);
});

test("test_applyCommitToState_removes_a_file_the_commit_deletes", (t) => {
    // Scenario: gone.txt is in the state at B and is gone after applying C.
    const { repo, commitB, commitC } = makeThreeCommitRepo(t);
    const state = applyCommitToState(commitC, checkOutRepoAt(repo, commitB), repo);
    assert.equal(state.containsPath(new Path("gone.txt")), false);
});

test("test_getChildCommitTowards_returns_the_next_commit_on_the_way", (t) => {
    // Scenario: the child of A on the way to C is B.
    const { repo, commitA, commitB, commitC } = makeThreeCommitRepo(t);
    const child = getChildCommitTowards(repo, commitA, commitC);
    assert.equal(child?.toString(), commitB.toString());
});

test("test_isCommitAtOrBefore_is_false_for_a_later_commit", (t) => {
    // Scenario: C comes after B, so C is not at or before B.
    const { repo, commitB, commitC } = makeThreeCommitRepo(t);
    assert.equal(isCommitAtOrBefore(repo, commitC, commitB), false);
});

test("test_runReplay_from_A_to_B_equals_checkout_of_B", (t) => {
    // Scenario: replaying A to B gives the state a checkout of B gives.
    const { repo, commitA, commitB } = makeThreeCommitRepo(t);
    const state = runReplay(checkOutRepoAt(repo, commitA), commitA, commitB, repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitB), state);
});

test("test_runReplay_from_A_to_C_equals_checkout_of_C", (t) => {
    // Scenario: replaying A to C gives the state a checkout of C gives.
    const { repo, commitA, commitC } = makeThreeCommitRepo(t);
    const state = runReplay(checkOutRepoAt(repo, commitA), commitA, commitC, repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitC), state);
});

function makeUserRecordWithToolResult(toolUseResult: unknown): JSONLLine {
    return { type: RecordType.user, toolUseResult };
}

function makeWriteRecord(absolutePath: string, content: string, resultType: string, originalFile: string | null): JSONLLine {
    return makeUserRecordWithToolResult({ type: resultType, filePath: absolutePath, content, structuredPatch: [], originalFile, userModified: false });
}

function makeEditRecord(absolutePath: string, oldString: string, newString: string, originalFile: string | null, replaceAll: boolean = false, structuredPatch: unknown[] = []): JSONLLine {
    return makeUserRecordWithToolResult({ filePath: absolutePath, oldString, newString, originalFile, structuredPatch, userModified: false, replaceAll });
}

function readStateText(state: RepoState, relativePath: string): string | undefined {
    return state.get(new Path(relativePath))?.toString("utf8");
}

test("test_getJSONLLineKind_is_WriteCreate_for_a_write_that_created_a_file", (t) => {
    // Scenario: a Write result with type "create" inside the repo has the WriteCreate kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord(join(repo.toString(), "new.txt"), "hello", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.WriteCreate);
});

test("test_getJSONLLineKind_returns_WriteCreate_for_a_Write_create_under_private_tmp", (t) => {
    // Scenario: a Write create result under /private/tmp is replayed, not skipped.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord("/private/tmp/claude-501/scratchpad/tabprobe.test.ts", "hello", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.WriteCreate);
});

test("test_getJSONLLineKind_returns_WriteCreate_for_a_Write_create_under_tmp", (t) => {
    // Scenario: a Write create result under /tmp is replayed, not skipped.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord("/tmp/scratch/probe.ts", "hello", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.WriteCreate);
});

test("test_getJSONLLineKind_returns_Skip_for_a_Write_create_in_an_outside_folder_that_is_not_tmp", (t) => {
    // Scenario: a Write create result in another outside folder stays Skip.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord("/Users/someone/else/file.ts", "hello", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_returns_Skip_for_a_Write_create_in_a_folder_that_only_starts_with_tmp", (t) => {
    // Scenario: /tmpfoo is not inside /tmp, so the Write stays Skip.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord("/tmpfoo/file.ts", "hello", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_returns_EditWholeFile_for_an_Edit_under_private_tmp", (t) => {
    // Scenario: an Edit result under /private/tmp whose oldString is the whole file is replayed.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeEditRecord("/private/tmp/scratch/probe.ts", "old", "brand new", "old");
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.EditWholeFile);
});

test("test_getJSONLLineKind_returns_Skip_for_an_Edit_in_an_outside_folder_that_is_not_tmp", (t) => {
    // Scenario: an Edit result in another outside folder stays Skip.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeEditRecord("/Users/someone/else/file.ts", "old", "brand new", "old");
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_EditWholeFile_when_oldString_is_the_whole_original_file", (t) => {
    // Scenario: an Edit result whose oldString equals originalFile has the EditWholeFile kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "old", "brand new", "old");
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.EditWholeFile);
});

// test("test_getJSONLLineKind_is_OriginalFile_for_an_edit_of_part_of_a_file", (t) => {
//     // Scenario: an Edit result whose oldString is only part of originalFile has the OriginalFile kind.
//     const { repo } = makeThreeCommitRepo(t);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "x", "middle");
//     assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.OriginalFile);
// });

// test("test_getJSONLLineKind_is_OriginalFile_for_a_write_that_updated_a_file", (t) => {
//     // Scenario: a Write result with type "update" and a non-null originalFile has the OriginalFile kind.
//     const { repo } = makeThreeCommitRepo(t);
//     const line = makeWriteRecord(join(repo.toString(), "change.txt"), "after", "update", "before");
//     assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.OriginalFile);
// });

test("test_getJSONLLineKind_returns_WriteUpdate_for_a_Write_that_replaces_a_file", (t) => {
    // Scenario: a Write result with type "update" inside the repo has the WriteUpdate kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord(join(repo.toString(), "change.txt"), "after", "update", "before");
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.WriteUpdate);
});

test("test_getJSONLLineKind_returns_EditPartial_for_an_Edit_of_part_of_a_file", (t) => {
    // Scenario: an Edit result whose oldString is only part of originalFile has the EditPartial kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "x", "middle");
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.EditPartial);
});

// Obsolete: a skipped Edit with no originalFile left its change out of the replay (Attune specs/message-rating-app.md).
// test("test_getJSONLLineKind_returns_Skip_for_a_partial_Edit_with_no_originalFile", (t) => {
//     // Scenario: an Edit result with a null originalFile has the Skip kind.
//     const { repo } = makeThreeCommitRepo(t);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "x", null);
//     assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
// });

test("test_getJSONLLineKind_returns_EditPartial_for_a_partial_Edit_with_no_originalFile", (t) => {
    // Scenario: an Edit result with a null originalFile still changed the file, so it has the EditPartial kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "x", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.EditPartial);
});

function makeSnapshotRecord(trackedFileBackups: object): JSONLLine {
    return { type: RecordType.fileHistorySnapshot, messageId: "m1", snapshot: { messageId: "m1", trackedFileBackups, timestamp: "2026-10-27T17:59:50.041Z" }, isSnapshotUpdate: false };
}

const ONE_BACKUP = { "keep.txt": { backupFileName: "abc@v1", version: 1, backupTime: "2026-10-27T17:59:50.041Z", realParentDir: "/somewhere" } };

test("test_getJSONLLineKind_is_Skip_for_a_snapshot_with_no_backups", (t) => {
    // Scenario: a file-history-snapshot record with empty trackedFileBackups has the Skip kind.
    const { repo } = makeThreeCommitRepo(t);
    assert.equal(getJSONLLineKind(makeSnapshotRecord({}), repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_Snapshot_for_a_snapshot_with_a_backup", (t) => {
    // Scenario: a file-history-snapshot record that lists one backup has the Snapshot kind.
    const { repo } = makeThreeCommitRepo(t);
    assert.equal(getJSONLLineKind(makeSnapshotRecord(ONE_BACKUP), repo), JSONLLineKind.Snapshot);
});

test("test_applyJSONLLineToState_throws_for_a_snapshot_with_a_backup", (t) => {
    // Scenario: a snapshot line that lists backups is not supported yet, so it throws.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    assert.throws(() => applyJSONLLineToState(state, makeSnapshotRecord(ONE_BACKUP), [], repo), /snapshot lines with backups are not supported yet/);
});

test("test_getJSONLLineKind_is_Skip_for_a_user_text_record", (t) => {
    // Scenario: a plain user text record has the Skip kind.
    const { repo } = makeThreeCommitRepo(t);
    const line: JSONLLine = { type: RecordType.user, message: { role: "user", content: "hi" } };
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_Skip_for_a_read_result", (t) => {
    // Scenario: a Read result (nested file object) has the Skip kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeUserRecordWithToolResult({ type: "text", file: { filePath: join(repo.toString(), "keep.txt"), content: "keep", numLines: 1, startLine: 1, totalLines: 1 } });
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

function makeUserEditRecord(absolutePath: string): JSONLLine {
    const attachment = { type: "edited_text_file", filename: absolutePath, snippet: "1\t# user was here" };
    return { type: RecordType.attachment, uuid: new Uuid("741f9817-9a3d-4275-936a-3d6b5a9d409e"), timestamp: new Date("2026-06-27T16:10:24.962Z"), attachment };
}

test("test_getJSONLLineKind_returns_UserEdit_for_an_edited_text_file_inside_the_repo", (t) => {
    // Scenario: an edited_text_file attachment whose file is in the repo has the UserEdit kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeUserEditRecord(join(repo.toString(), "a.txt"));
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.UserEdit);
});

test("test_getJSONLLineKind_returns_Skip_for_an_edited_text_file_outside_the_repo", (t) => {
    // Scenario: an edited_text_file attachment whose file is outside the repo has the Skip kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeUserEditRecord(join(repo.toString(), "..", "elsewhere.txt"));
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_Skip_for_a_path_outside_the_repo", (t) => {
    // Scenario: a Write create whose file is outside the repo has the Skip kind.
    const { repo } = makeThreeCommitRepo(t);
    const line = makeWriteRecord(join(repo.toString(), "..", "elsewhere.txt"), "x", "create", null);
    assert.equal(getJSONLLineKind(line, repo), JSONLLineKind.Skip);
});

test("test_applyJSONLLineToState_adds_the_file_a_write_created", (t) => {
    // Scenario: a Write create of new.txt puts "hello" into the state.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const line = makeWriteRecord(join(repo.toString(), "new.txt"), "hello", "create", null);
    applyJSONLLineToState(state, line, [], repo);
    assert.equal(readStateText(state, "new.txt"), "hello");
});

test("test_applyJSONLLineToState_replaces_a_file_when_an_edit_changes_the_whole_file", (t) => {
    // Scenario: an Edit with oldString equal to originalFile sets change.txt to newString.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "old", "brand new", "old");
    applyJSONLLineToState(state, line, [], repo);
    assert.equal(readStateText(state, "change.txt"), "brand new");
});

// test("test_applyJSONLLineToState_sets_a_file_to_originalFile_for_a_partial_edit", (t) => {
//     // Scenario: a partial Edit sets change.txt to originalFile and does not apply its own change.
//     const { repo, commitA } = makeThreeCommitRepo(t);
//     const state = checkOutRepoAt(repo, commitA);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "x", "middle");
//     applyJSONLLineToState(state, line, [], repo);
//     assert.equal(readStateText(state, "change.txt"), "middle");
// });

test("test_applyJSONLLineToState_sets_the_file_to_the_Write_update_content", (t) => {
    // Scenario: a Write update of change.txt sets the file to the Write's content.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const line = makeWriteRecord(join(repo.toString(), "change.txt"), "after", "update", "before");
    applyJSONLLineToState(state, line, [], repo);
    assert.equal(readStateText(state, "change.txt"), "after");
});

// test("test_applyJSONLLineToState_replaces_the_first_old_string_for_a_partial_Edit", (t) => {
//     const { repo, commitA } = makeThreeCommitRepo(t);
//     const state = checkOutRepoAt(repo, commitA);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "ab", "X", "ab-ab-ab", false);
//     applyJSONLLineToState(state, line, [], repo);
//     assert.equal(readStateText(state, "change.txt"), "X-ab-ab");
// });

// test("test_applyJSONLLineToState_replaces_every_old_string_when_replaceAll_is_true", (t) => {
//     const { repo, commitA } = makeThreeCommitRepo(t);
//     const state = checkOutRepoAt(repo, commitA);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "ab", "X", "ab-ab-ab", true);
//     applyJSONLLineToState(state, line, [], repo);
//     assert.equal(readStateText(state, "change.txt"), "X-X-X");
// });

// test("test_applyJSONLLineToState_keeps_dollar_signs_in_new_string_for_a_partial_Edit", (t) => {
//     const { repo, commitA } = makeThreeCommitRepo(t);
//     const state = checkOutRepoAt(repo, commitA);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "mid", "$& and $1", "a-mid-z");
//     applyJSONLLineToState(state, line, [], repo);
//     assert.equal(readStateText(state, "change.txt"), "a-$& and $1-z");
// });

// test("test_applyJSONLLineToState_throws_when_the_old_string_is_not_in_the_file", (t) => {
//     const { repo, commitA } = makeThreeCommitRepo(t);
//     const state = checkOutRepoAt(repo, commitA);
//     const line = makeEditRecord(join(repo.toString(), "change.txt"), "nope", "x", "middle");
//     assert.throws(() => applyJSONLLineToState(state, line, [], repo), /old_string not found/);
// });

test("test_applyJSONLLineToState_applies_the_structuredPatch_for_a_partial_Edit", (t) => {
    // Scenario: one hunk changes the middle line of a three-line file, and the trailing newline stays.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const hunk = { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" one", "-two", "+TWO", " three"] };
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "two", "TWO", "one\ntwo\nthree\n", false, [hunk]);
    applyJSONLLineToState(state, line, [], repo);
    assert.equal(readStateText(state, "change.txt"), "one\nTWO\nthree\n");
});

test("test_applyJSONLLineToState_applies_two_hunks_for_a_partial_Edit", (t) => {
    // Scenario: two separate hunks change line 1 and line 5 of a five-line file.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const firstHunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+A"] };
    const secondHunk = { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ["-e", "+E"] };
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "a", "A", "a\nb\nc\nd\ne\n", true, [firstHunk, secondHunk]);
    applyJSONLLineToState(state, line, [], repo);
    assert.equal(readStateText(state, "change.txt"), "A\nb\nc\nd\nE\n");
});

test("test_applyJSONLLineToState_throws_when_a_hunk_does_not_match_the_originalFile", (t) => {
    // Scenario: the hunk removes "zzz" but the file has "two" at that line, so applying the Edit throws.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const hunk = { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-zzz", "+ZZZ"] };
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "zzz", "ZZZ", "one\ntwo\nthree\n", false, [hunk]);
    assert.throws(() => applyJSONLLineToState(state, line, [], repo), /hunk does not match originalFile/);
});

test("test_applyJSONLLineToState_leaves_the_state_unchanged_for_a_user_text_record", (t) => {
    // Scenario: a Skip-kind line changes nothing in the state.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const line: JSONLLine = { type: RecordType.user, message: { role: "user", content: "hi" } };
    applyJSONLLineToState(state, line, [], repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitA), state);
});

test("test_applyJSONLLineToState_leaves_the_state_unchanged_for_a_path_outside_the_repo", (t) => {
    // Scenario: a Write create outside the repo changes nothing in the state.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const state = checkOutRepoAt(repo, commitA);
    const line = makeWriteRecord(join(repo.toString(), "..", "elsewhere.txt"), "x", "create", null);
    applyJSONLLineToState(state, line, [], repo);
    assertRepoStatesEqual(checkOutRepoAt(repo, commitA), state);
});

function makeCommitEvent(commit: CommitHash, timestamp: number): TimelineEvent {
    return { type: TimelineEventKind.GitCommit, commit, timestamp };
}

function makeLineEvent(line: JSONLLine, timestamp: number): TimelineEvent {
    return { type: TimelineEventKind.JSONLLine, line, timestamp };
}

test("test_createGitCommitForRange_applies_a_commit_event", (t) => {
    // Scenario: a range holding only commit B, started at the state of A, gives the state of B.
    const { repo, commitA, commitB } = makeThreeCommitRepo(t);
    const events: JSONLAndGitEvents = [makeCommitEvent(commitB, 1)];
    const state = createGitCommitForRange(events, 0, 1, [], repo, checkOutRepoAt(repo, commitA));
    assertRepoStatesEqual(checkOutRepoAt(repo, commitB), state);
});

test("test_createGitCommitForRange_applies_a_write_create_line", (t) => {
    // Scenario: a range holding one Write-create line gives the state with the new file.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const line = makeWriteRecord(join(repo.toString(), "new.txt"), "hello", "create", null);
    const events: JSONLAndGitEvents = [makeLineEvent(line, 1)];
    const state = createGitCommitForRange(events, 0, 1, [], repo, checkOutRepoAt(repo, commitA));
    assert.equal(readStateText(state, "new.txt"), "hello");
});

test("test_createGitCommitForRange_applies_a_commit_then_a_line_in_order", (t) => {
    // Scenario: commit B then an Edit line, applied in order, leave change.txt as "newer".
    const { repo, commitA, commitB } = makeThreeCommitRepo(t);
    const line = makeEditRecord(join(repo.toString(), "change.txt"), "new", "newer", "new");
    const events: JSONLAndGitEvents = [makeCommitEvent(commitB, 1), makeLineEvent(line, 2)];
    const state = createGitCommitForRange(events, 0, 2, [], repo, checkOutRepoAt(repo, commitA));
    assert.equal(readStateText(state, "change.txt"), "newer");
});

test("test_createGitCommitForRange_throws_when_startIndex_is_after_endIndex", (t) => {
    // Scenario: startIndex 2 with endIndex 1 breaks the range rule, so it throws.
    const { repo, commitA } = makeThreeCommitRepo(t);
    assert.throws(() => createGitCommitForRange([], 2, 1, [], repo, checkOutRepoAt(repo, commitA)));
});

test("test_createGitCommitForRange_does_not_apply_the_event_at_endIndex", (t) => {
    // Scenario: range 0 to 1 applies the event at index 0 and stops before the event at index 1.
    const { repo, commitA } = makeThreeCommitRepo(t);
    const firstLine = makeWriteRecord(join(repo.toString(), "first.txt"), "1", "create", null);
    const secondLine = makeWriteRecord(join(repo.toString(), "second.txt"), "2", "create", null);
    const events: JSONLAndGitEvents = [makeLineEvent(firstLine, 1), makeLineEvent(secondLine, 2)];
    const state = createGitCommitForRange(events, 0, 1, [], repo, checkOutRepoAt(repo, commitA));
    assert.equal(readStateText(state, "first.txt"), "1");
    assert.equal(state.containsPath(new Path("second.txt")), false);
});
