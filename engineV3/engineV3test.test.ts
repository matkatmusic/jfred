import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { executeEngineV3Test, filterCommitsSavedWithTheNext, listCommitsFromStartToEnd, type EngineV3TestSettings } from "./engineV3test.ts";

type TimedRepo = { repoFolder: string; commitA: string; commitB: string; commitC: string };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function commitFileWithDate(repoFolder: string, isoDate: string, name: string, content: string): string {
    writeFileSync(join(repoFolder, name), content);
    runGitWithDate(repoFolder, isoDate, ["add", "-A"]);
    runGitWithDate(repoFolder, isoDate, ["commit", "-q", "-m", name]);
    return runGitWithDate(repoFolder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// A at 10s, B at 20s adds added.txt, C at 30s changes change.txt.
function makeTimedRepo(t: TestContext): TimedRepo {
    const repoFolder = makeTempFolder(t, "engine-v3-timed-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileSync(join(repoFolder, "keep.txt"), "keep");
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "change.txt", "old");
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "added.txt", "added");
    const commitC = commitFileWithDate(repoFolder, "2026-01-01T00:00:30Z", "change.txt", "new");
    return { repoFolder, commitA, commitB, commitC };
}

function makeWriteCreateLine(repoFolder: string, fileName: string, content: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { type: "create", filePath: join(repoFolder, fileName), content, structuredPatch: [], originalFile: null, userModified: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

function makeEditWholeFileLine(repoFolder: string, fileName: string, oldContent: string, newContent: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { filePath: join(repoFolder, fileName), oldString: oldContent, newString: newContent, originalFile: oldContent, structuredPatch: [], userModified: false, replaceAll: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

function writeJSONLFile(folder: string, fileName: string, lines: string[]): void {
    writeFileSync(join(folder, fileName), lines.join("\n") + "\n");
}

function makeSettings(timedRepo: TimedRepo, startingCommit: string, endingCommit: string, jsonlFolder: string): EngineV3TestSettings {
    return { repo: timedRepo.repoFolder, startingCommit, endingCommit, jsonlFolders: [jsonlFolder], snapshotFolders: [] };
}

// test("test_listCommitsFromStartToEnd_follows_the_first_parent_path_past_a_merge", (t) => {
//     // Scenario: the list is A, B, M and skips the merged side commit.
//     const repoFolder = makeTempFolder(t, "engine-v3-merge-repo-");
//     const isoDate = "2026-01-01T00:00:10Z";
//     runGitWithDate(repoFolder, isoDate, ["init", "-q", "-b", "main"]);
//     const commitA = commitFileWithDate(repoFolder, isoDate, "a.txt", "a");
//     runGitWithDate(repoFolder, isoDate, ["checkout", "-q", "-b", "side"]);
//     commitFileWithDate(repoFolder, isoDate, "side.txt", "side");
//     runGitWithDate(repoFolder, isoDate, ["checkout", "-q", "main"]);
//     const commitB = commitFileWithDate(repoFolder, isoDate, "b.txt", "b");
//     runGitWithDate(repoFolder, isoDate, ["merge", "-q", "--no-ff", "-m", "merge", "side"]);
//     const commitM = runGitWithDate(repoFolder, isoDate, ["rev-parse", "HEAD"]);
//     const commits = listCommitsFromStartToEnd(new Path(repoFolder), new Uuid(commitA), new Uuid(commitM));
//     const hashes: string[] = [];
//     for (const commit of commits) {
//         hashes.push(commit.toString());
//     }
//     assert.deepEqual(hashes, [commitA, commitB, commitM]);
// });

test("test_listCommitsFromStartToEnd_lists_side_branch_commits_in_time_order", (t) => {
    // Scenario: commits A (main), S (side), then no-ff merge M list in time order A, S, M.
    const repoFolder = makeTempFolder(t, "engine-v3-side-branch-repo-");
    // make main with commit A at t1
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q", "-b", "main"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "a.txt", "a");
    // make side with commit S at t2
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["checkout", "-q", "-b", "side"]);
    const commitS = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "side.txt", "side");
    // merge side into main at t3 to create M
    runGitWithDate(repoFolder, "2026-01-01T00:00:30Z", ["checkout", "-q", "main"]);
    runGitWithDate(repoFolder, "2026-01-01T00:00:30Z", ["merge", "-q", "--no-ff", "-m", "merge", "side"]);
    const commitM = runGitWithDate(repoFolder, "2026-01-01T00:00:30Z", ["rev-parse", "HEAD"]);
    // list from A to M and compare the hashes in order
    const commits = listCommitsFromStartToEnd(new Path(repoFolder), new Uuid(commitA), new Uuid(commitM));
    const hashes: string[] = [];
    for (const commit of commits) {
        hashes.push(commit.toString());
    }
    assert.deepEqual(hashes, [commitA, commitS, commitM]);
});

test("test_listCommitsFromStartToEnd_throws_when_the_previous_commit_is_not_a_parent", (t) => {
    // Scenario: B's parent is A, not the previous commit S, so the list throws.
    const repoFolder = makeTempFolder(t, "engine-v3-unconnected-repo-");
    // make main with commit A at t1
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q", "-b", "main"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "a.txt", "a");
    // make side with commit S at t2
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["checkout", "-q", "-b", "side"]);
    commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "side.txt", "side");
    // make commit B on main at t3, with parent A
    runGitWithDate(repoFolder, "2026-01-01T00:00:30Z", ["checkout", "-q", "main"]);
    commitFileWithDate(repoFolder, "2026-01-01T00:00:30Z", "b.txt", "b");
    // merge side into main at t4 to create M
    runGitWithDate(repoFolder, "2026-01-01T00:00:40Z", ["merge", "-q", "--no-ff", "-m", "merge", "side"]);
    const commitM = runGitWithDate(repoFolder, "2026-01-01T00:00:40Z", ["rev-parse", "HEAD"]);
    // listing from A to M must throw
    assert.throws(() => listCommitsFromStartToEnd(new Path(repoFolder), new Uuid(commitA), new Uuid(commitM)), /does not have the previous commit/);
});

test("test_executeEngineV3Test_passes_a_pair_when_a_line_makes_up_the_commit_change", (t) => {
    // Scenario: a Write-create of added.txt between A and B makes the state equal B.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "added.txt", "added", 15)]);
    executeEngineV3Test(makeSettings(timedRepo, timedRepo.commitA, timedRepo.commitB, jsonlFolder));
});

test("test_executeEngineV3Test_throws_when_a_commit_change_has_no_line", (t) => {
    // Scenario: no line creates added.txt, so the run throws with both short hashes.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "other.txt", "x", 15)]);
    const settings = makeSettings(timedRepo, timedRepo.commitA, timedRepo.commitB, jsonlFolder);
    const expectedMessage = `failed reconstruction between ${timedRepo.commitA.slice(0, 8)} and ${timedRepo.commitB.slice(0, 8)}`;
    assert.throws(() => executeEngineV3Test(settings), (error: Error) => error.message === expectedMessage);
});

test("test_executeEngineV3Test_drops_a_replayed_file_the_child_commit_does_not_track", (t) => {
    // Scenario: scratch.txt is untracked in B, so it is dropped and the pair passes.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "added.txt", "added", 15), makeWriteCreateLine(timedRepo.repoFolder, "scratch.txt", "tmp", 16)]);
    executeEngineV3Test(makeSettings(timedRepo, timedRepo.commitA, timedRepo.commitB, jsonlFolder));
});

test("test_executeEngineV3Test_uses_the_starting_and_ending_commit_of_the_settings", (t) => {
    // Scenario: start B and end C need only the Edit line at 25s.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeEditWholeFileLine(timedRepo.repoFolder, "change.txt", "old", "new", 25)]);
    executeEngineV3Test(makeSettings(timedRepo, timedRepo.commitB, timedRepo.commitC, jsonlFolder));
});

test("test_executeEngineV3Test_keeps_a_file_written_before_a_commit_that_saves_it_later", (t) => {
    // Scenario: later.txt is written before B but committed in C, so state carries.  make A at 10s
    const repoFolder = makeTempFolder(t, "engine-v3-carry-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "change.txt", "old");
    // make B at 20s, which commits only added.txt
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "added.txt", "added");
    // make C at 30s, which commits later.txt
    const commitC = commitFileWithDate(repoFolder, "2026-01-01T00:00:30Z", "later.txt", "later");
    // write later.txt at 15s and added.txt at 17s, both before B
    const jsonlFolder = makeTempFolder(t, "engine-v3-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(repoFolder, "later.txt", "later", 15), makeWriteCreateLine(repoFolder, "added.txt", "added", 17)]);
    // the run from A to C passes because later.txt is still in the state when C is compared
    const timedRepo: TimedRepo = { repoFolder, commitA, commitB, commitC };
    executeEngineV3Test(makeSettings(timedRepo, commitA, commitC, jsonlFolder));
});

test("test_filterCommitsSavedWithTheNext_drops_a_commit_saved_in_the_same_second_as_the_next", (t) => {
    // Scenario: B and C share a committer time, so the list is A, C.  make A at 10s
    const repoFolder = makeTempFolder(t, "engine-v3-same-second-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "a.txt", "a");
    // make B and C both at 20s
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "b.txt", "b");
    const commitC = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "c.txt", "c");
    // filter the list A, B, C
    const commits = [new Uuid(commitA), new Uuid(commitB), new Uuid(commitC)];
    const filteredCommits = filterCommitsSavedWithTheNext(new Path(repoFolder), commits);
    const hashes: string[] = [];
    for (const commit of filteredCommits) {
        hashes.push(commit.toString());
    }
    // B is gone
    assert.deepEqual(hashes, [commitA, commitC]);
});

test("test_filterCommitsSavedWithTheNext_keeps_commits_saved_far_apart", (t) => {
    // Scenario: A, B, C are 10s apart, so none is dropped.
    const timedRepo = makeTimedRepo(t);
    // filter the list A, B, C
    const commits = [new Uuid(timedRepo.commitA), new Uuid(timedRepo.commitB), new Uuid(timedRepo.commitC)];
    const filteredCommits = filterCommitsSavedWithTheNext(new Path(timedRepo.repoFolder), commits);
    const hashes: string[] = [];
    for (const commit of filteredCommits) {
        hashes.push(commit.toString());
    }
    // all three stay
    assert.deepEqual(hashes, [timedRepo.commitA, timedRepo.commitB, timedRepo.commitC]);
});

test("test_filterCommitsSavedWithTheNext_keeps_the_starting_commit", (t) => {
    // Scenario: A and B are saved in the same second, but A is the starting commit, so it stays.
    const repoFolder = makeTempFolder(t, "engine-v3-start-same-second-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    // make A and B both at 10s
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "a.txt", "a");
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "b.txt", "b");
    // filter the list A, B
    const commits = [new Uuid(commitA), new Uuid(commitB)];
    const filteredCommits = filterCommitsSavedWithTheNext(new Path(repoFolder), commits);
    const hashes: string[] = [];
    for (const commit of filteredCommits) {
        hashes.push(commit.toString());
    }
    // both stay
    assert.deepEqual(hashes, [commitA, commitB]);
});
