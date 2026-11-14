import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { applyOutsideGitRow, listOutsideGitRows, OutsideGitKind, type OutsideGitRow } from "./engineV3_replay_outside_git.ts";
const BASE_SECONDS = 1790000000;

type SourceRepo = { gitFolder: string; commit1: string; commit2: string; commit3: string };

function runGitAt(folder: string, secondsOffset: number, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const date = `${BASE_SECONDS + secondsOffset} +0000`;
    const env = { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8", env }).trim();
}

function commitFileAt(folder: string, secondsOffset: number, fileName: string): string {
    writeFileSync(join(folder, fileName), fileName);
    runGitAt(folder, secondsOffset, ["add", "-A"]);
    runGitAt(folder, secondsOffset, ["commit", "-q", "-m", fileName]);
    return runGitAt(folder, secondsOffset, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// HEAD log rows: +10 commit 1, +20 commit 2, +30 checkout to side, +40 commit 3, +50 checkout to main, +60 reset to commit 1.
function makeSourceRepo(t: TestContext): SourceRepo {
    const workFolder = makeTempFolder(t, "engine-v3-outside-source-");
    runGitAt(workFolder, 0, ["init", "-q", "-b", "main"]);
    const commit1 = commitFileAt(workFolder, 10, "a.txt");
    const commit2 = commitFileAt(workFolder, 20, "b.txt");
    runGitAt(workFolder, 30, ["checkout", "-q", "-b", "side"]);
    const commit3 = commitFileAt(workFolder, 40, "c.txt");
    runGitAt(workFolder, 50, ["checkout", "-q", "main"]);
    runGitAt(workFolder, 60, ["reset", "-q", "--hard", "HEAD~1"]);
    return { gitFolder: join(workFolder, ".git"), commit1, commit2, commit3 };
}

// The state repo holds only the listed commit, as a replay at that point would.
function makeStateAt(t: TestContext, source: SourceRepo, commit: string): string {
    const stateFolder = makeTempFolder(t, "engine-v3-outside-state-");
    runGitAt(stateFolder, 0, ["init", "-q", "-b", "main"]);
    runGitAt(stateFolder, 0, ["fetch", "-q", "--no-tags", source.gitFolder, commit]);
    runGitAt(stateFolder, 0, ["reset", "-q", "--hard", commit]);
    return stateFolder;
}

function makeBashCallResult(startSeconds: number, endSeconds: number, command: string = "git checkout main"): Map<string, BashCallResult> {
    return new Map([["toolu_1", { toolUseId: new Uuid("toolu_1"), startMs: startSeconds * 1000, endMs: endSeconds * 1000, isError: false, resultText: "", command }]]);
}

function listRowsOf(source: SourceRepo, bashCalls: Map<string, BashCallResult>, startOffset: number): OutsideGitRow[] {
    return listOutsideGitRows(new Path(source.gitFolder), bashCalls, BASE_SECONDS + startOffset);
}

test("test_listOutsideGitRows_names_the_kind_of_each_row", (t) => {
    // Scenario: commit, checkout and reset messages map to their kinds, in reflog order.
    const source = makeSourceRepo(t);
    // no Bash call covers any row
    const rows = listRowsOf(source, new Map(), 5);
    // the kinds follow the reflog
    const kinds = rows.map((row) => row.kind);
    assert.deepEqual(kinds, [OutsideGitKind.Commit, OutsideGitKind.Commit, OutsideGitKind.Checkout, OutsideGitKind.Commit, OutsideGitKind.Checkout, OutsideGitKind.Reset]);
});

test("test_listOutsideGitRows_skips_rows_at_or_before_the_start_second", (t) => {
    // Scenario: the row at exactly the start second is not after it.
    const source = makeSourceRepo(t);
    const rows = listRowsOf(source, new Map(), 20);
    // the +20 row is gone; the +30 checkout is first
    assert.equal(rows[0]?.kind, OutsideGitKind.Checkout);
});

test("test_listOutsideGitRows_skips_rows_inside_a_bash_call_window", (t) => {
    // Scenario: a Bash call from +39.5 to +40.2 covers the +40 commit 3 row.
    const source = makeSourceRepo(t);
    const bashCalls = makeBashCallResult(BASE_SECONDS + 39.5, BASE_SECONDS + 40.2);
    const rows = listRowsOf(source, bashCalls, 5);
    // commit 3 is not listed
    assert.equal(rows.length, 5);
});

test("test_listOutsideGitRows_window_reaches_one_second_before_the_call_start", (t) => {
    // Scenario: a call starting at +41 has a window from +40, so the +40 row is covered.
    const source = makeSourceRepo(t);
    const rows = listRowsOf(source, makeBashCallResult(BASE_SECONDS + 41, BASE_SECONDS + 41), 5);
    assert.equal(rows.length, 5);
});

test("test_listOutsideGitRows_keeps_a_row_inside_the_window_of_a_call_that_names_no_git", (t) => {
    // Scenario: a call from +39.5 to +40.2 runs `ls`, so the +40 commit 3 row is not its work.
    const source = makeSourceRepo(t);
    const bashCalls = makeBashCallResult(BASE_SECONDS + 39.5, BASE_SECONDS + 40.2, "ls -la");
    const rows = listRowsOf(source, bashCalls, 5);
    // commit 3 is listed
    assert.equal(rows.length, 6);
});

test("test_listOutsideGitRows_skips_a_row_inside_the_window_of_a_call_that_runs_a_script_file", (t) => {
    // Scenario: a call from +39.5 to +40.2 runs `bash rewrite.sh`, which can run git, so it covers the +40 row.
    const source = makeSourceRepo(t);
    const bashCalls = makeBashCallResult(BASE_SECONDS + 39.5, BASE_SECONDS + 40.2, "bash rewrite.sh | tail -40");
    const rows = listRowsOf(source, bashCalls, 5);
    // commit 3 is not listed
    assert.equal(rows.length, 5);
});

test("test_listOutsideGitRows_throws_on_an_unknown_reflog_message", (t) => {
    // Scenario: a merge row has no replay, so listing throws.
    const source = makeSourceRepo(t);
    runGitAt(join(source.gitFolder, ".."), 70, ["merge", "-q", "--ff-only", "side"]);
    assert.throws(() => listRowsOf(source, new Map(), 5), /no replay for reflog message "merge side/);
});

test("test_applyOutsideGitRow_commit_moves_the_branch_and_writes_the_file", (t) => {
    // Scenario: state is at commit 1; the commit 2 row moves main to commit 2 and writes b.txt.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit1);
    const rows = listRowsOf(source, new Map(), 15);
    // apply the commit 2 row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // main is at commit 2 and the file is on disk
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "main"]), source.commit2);
    assert.equal(existsSync(join(stateFolder, "b.txt")), true);
});

test("test_applyOutsideGitRow_checkout_moves_HEAD_to_the_target_branch", (t) => {
    // Scenario: state is at commit 2 with a side branch at commit 2; the checkout row moves HEAD to side.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    runGitAt(stateFolder, 0, ["branch", "side"]);
    const rows = listRowsOf(source, new Map(), 25);
    // apply the +30 checkout row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // HEAD names side
    assert.equal(runGitAt(stateFolder, 0, ["symbolic-ref", "--short", "HEAD"]), "side");
});

test("test_applyOutsideGitRow_reset_moves_the_branch_and_untracks_files", (t) => {
    // Scenario: state is at commit 2; the reset row moves main back to commit 1 and removes b.txt from the index and the disk (a --keep reset updates files that differ).
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    const rows = listRowsOf(source, new Map(), 55);
    // apply the reset row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // main is at commit 1 and b.txt is no longer tracked
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "main"]), source.commit1);
    assert.equal(existsSync(join(stateFolder, "b.txt")), false);
    assert.equal(runGitAt(stateFolder, 0, ["ls-files", "b.txt"]), "");
});

test("test_applyOutsideGitRow_reset_brings_in_files_the_target_adds", (t) => {
    // Scenario: state HEAD lacks a.txt, which the reset target (commit 1) has; the reset row puts a.txt on disk.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    runGitAt(stateFolder, 0, ["rm", "-q", "a.txt"]);
    runGitAt(stateFolder, 0, ["commit", "-q", "-m", "remove a.txt"]);
    assert.equal(existsSync(join(stateFolder, "a.txt")), false);
    const rows = listRowsOf(source, new Map(), 55);
    // apply the reset row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // HEAD is commit 1 and a.txt is on disk
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]), source.commit1);
    assert.equal(existsSync(join(stateFolder, "a.txt")), true);
});

test("test_applyOutsideGitRow_reset_keeps_an_uncommitted_change_in_the_work_tree", (t) => {
    // Scenario: state is at commit 2 with an uncommitted edit to a.txt; the reset row moves main to commit 1.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    writeFileSync(join(stateFolder, "a.txt"), "uncommitted edit");
    const rows = listRowsOf(source, new Map(), 55);
    // apply the reset row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // HEAD is commit 1 and a.txt still holds the uncommitted edit
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]), source.commit1);
    assert.equal(readFileSync(join(stateFolder, "a.txt"), "utf8"), "uncommitted edit");
});

test("test_applyOutsideGitRow_reset_succeeds_when_a_differing_file_was_rewritten_with_the_same_bytes", (t) => {
    // Scenario: state is at commit 2; b.txt differs from the reset target (commit 1). A --start-at restore rewrote b.txt with the same bytes and a new mtime, so the index stat data is stale.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    const stalePath = join(stateFolder, "b.txt");
    writeFileSync(stalePath, readFileSync(stalePath));
    utimesSync(stalePath, new Date(1700000000000), new Date(1700000000000));
    const rows = listRowsOf(source, new Map(), 55);
    // apply the reset row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), rows[0] as OutsideGitRow);
    // HEAD is commit 1 and b.txt is gone, as the target has no b.txt
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]), source.commit1);
    assert.equal(existsSync(stalePath), false);
});

test("test_applyOutsideGitRow_throws_when_HEAD_is_not_the_row_new_commit", (t) => {
    // Scenario: a checkout row whose new commit differs from where the checkout lands.
    const source = makeSourceRepo(t);
    const stateFolder = makeStateAt(t, source, source.commit2);
    runGitAt(stateFolder, 0, ["branch", "side"]);
    const rows = listRowsOf(source, new Map(), 25);
    // the row says commit 1 but side is at commit 2
    const wrongRow = { ...(rows[0] as OutsideGitRow), newCommit: source.commit1 };
    assert.throws(() => applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), wrongRow), /is not the row's new commit/);
});

const SUBMODULE_PATH = "playground/typesafe-checks";
const SUBMODULE_URL = "https://github.com/matkatmusic/typesafe-checks.git";
const NULL_COMMIT = "0".repeat(40);

type SubmoduleSource = { gitFolder: string; commit1: string; commit2: string; commit3: string };

function formatReflogRow(oldCommit: string, newCommit: string, secondsOffset: number, message: string): string {
    return `${oldCommit} ${newCommit} test <test@example.com> ${BASE_SECONDS + secondsOffset} +0000\t${message}\n`;
}

// The source's submodule log rows: +100 clone at commit 1, +200 pull to commit 2, +300 commit 3 (made after the pull). The submodule git folder holds all 3 commits, as the Mac's does today.
function makeSubmoduleSource(t: TestContext): SubmoduleSource {
    const upstreamFolder = makeTempFolder(t, "engine-v3-outside-upstream-");
    runGitAt(upstreamFolder, 0, ["init", "-q", "-b", "master"]);
    commitFileAt(upstreamFolder, 1, "zero.txt");
    const commit1 = commitFileAt(upstreamFolder, 2, "one.txt");
    const commit2 = commitFileAt(upstreamFolder, 3, "two.txt");
    const commit3 = commitFileAt(upstreamFolder, 4, "three.txt");
    const superFolder = makeTempFolder(t, "engine-v3-outside-super-");
    runGitAt(superFolder, 0, ["init", "-q", "-b", "main"]);
    commitFileAt(superFolder, 10, "root.txt");
    const moduleFolder = join(superFolder, ".git", "modules", SUBMODULE_PATH);
    runGitAt(superFolder, 0, ["clone", "-q", "--bare", upstreamFolder, moduleFolder]);
    mkdirSync(join(moduleFolder, "logs"), { recursive: true });
    const cloneRow = formatReflogRow(NULL_COMMIT, commit1, 100, `clone: from ${SUBMODULE_URL}`);
    const pullRow = formatReflogRow(commit1, commit2, 200, "pull --tags origin master: Fast-forward");
    const commitRow = formatReflogRow(commit2, commit3, 300, "commit: later work");
    writeFileSync(join(moduleFolder, "logs", "HEAD"), cloneRow + pullRow + commitRow);
    return { gitFolder: join(superFolder, ".git"), commit1, commit2, commit3 };
}

function makeStateWithOneCommit(t: TestContext): string {
    const stateFolder = makeTempFolder(t, "engine-v3-outside-state-");
    runGitAt(stateFolder, 0, ["init", "-q", "-b", "main"]);
    commitFileAt(stateFolder, 0, "state.txt");
    return stateFolder;
}

function listSubmoduleRowsOf(source: SubmoduleSource, bashCalls: Map<string, BashCallResult>): OutsideGitRow[] {
    return listOutsideGitRows(new Path(source.gitFolder), bashCalls, BASE_SECONDS + 50);
}

function applySubmoduleRows(stateFolder: string, source: SubmoduleSource, rowCount: number): void {
    const rows = listSubmoduleRowsOf(source, new Map());
    for (const row of rows.slice(0, rowCount)) {
        applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), row);
    }
}

test("test_listOutsideGitRows_names_the_submodule_clone_pull_and_commit_rows", (t) => {
    // Scenario: the submodule log has a clone row, a pull row and a commit row.
    const source = makeSubmoduleSource(t);
    const rows = listSubmoduleRowsOf(source, new Map());
    // the kinds, new commits and submodule path follow the clone, pull and commit rows
    assert.deepEqual(rows.map((row) => row.kind), [OutsideGitKind.SubmoduleClone, OutsideGitKind.SubmodulePull, OutsideGitKind.SubmoduleCommit]);
    assert.deepEqual(rows.map((row) => row.newCommit), [source.commit1, source.commit2, source.commit3]);
    assert.deepEqual(rows.map((row) => row.submodulePath?.toString()), [SUBMODULE_PATH, SUBMODULE_PATH, SUBMODULE_PATH]);
});

test("test_listOutsideGitRows_skips_a_submodule_row_inside_a_bash_call_window", (t) => {
    // Scenario: a `git` call from +99.5 to +100.2 covers the +100 clone row.
    const source = makeSubmoduleSource(t);
    const bashCalls = makeBashCallResult(BASE_SECONDS + 99.5, BASE_SECONDS + 100.2, "git submodule add x y");
    const rows = listSubmoduleRowsOf(source, bashCalls);
    // only the pull and commit rows are listed
    assert.deepEqual(rows.map((row) => row.kind), [OutsideGitKind.SubmodulePull, OutsideGitKind.SubmoduleCommit]);
});

test("test_applyOutsideGitRow_submodule_clone_checks_out_the_clone_commit_on_master", (t) => {
    // Scenario: the source's submodule folder also holds the later commits 2 and 3.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone row
    applySubmoduleRows(stateFolder, source, 1);
    // the submodule is on master at commit 1, and commits 2 and 3 are in no ref
    const submoduleFolder = join(stateFolder, SUBMODULE_PATH);
    assert.equal(runGitAt(submoduleFolder, 0, ["symbolic-ref", "--short", "HEAD"]), "master");
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "HEAD"]), source.commit1);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "origin/master"]), source.commit1);
    const reachableCommits = runGitAt(submoduleFolder, 0, ["rev-list", "--all"]);
    assert.equal(reachableCommits.includes(source.commit2), false);
    assert.equal(reachableCommits.includes(source.commit3), false);
});

test("test_applyOutsideGitRow_submodule_clone_stages_gitmodules_and_the_gitlink_at_the_clone_commit", (t) => {
    // Scenario: like the Mac after `git submodule add`, nothing is committed.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone row
    applySubmoduleRows(stateFolder, source, 1);
    // both paths are staged as added, and the staged gitlink names commit 1
    assert.equal(runGitAt(stateFolder, 0, ["status", "--short"]), `A  .gitmodules\nA  ${SUBMODULE_PATH}`);
    assert.equal(runGitAt(stateFolder, 0, ["ls-files", "-s", SUBMODULE_PATH]).startsWith(`160000 ${source.commit1}`), true);
});

test("test_applyOutsideGitRow_submodule_clone_leaves_the_state_HEAD_on_its_own_commit", (t) => {
    // Scenario: the clone row changes the submodule, not the state's own branch.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    const headBefore = runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]);
    // apply the clone row
    applySubmoduleRows(stateFolder, source, 1);
    // the state HEAD did not move
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]), headBefore);
});

test("test_applyOutsideGitRow_submodule_clone_keeps_the_github_url_not_the_local_path", (t) => {
    // Scenario: the clone reads the local submodule folder, but the Mac's clone read GitHub.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone row
    applySubmoduleRows(stateFolder, source, 1);
    // the staged .gitmodules, the state config and the submodule origin all hold the GitHub URL
    assert.match(runGitAt(stateFolder, 0, ["show", ":.gitmodules"]), new RegExp(`url = ${SUBMODULE_URL.replaceAll(".", "\\.")}$`, "m"));
    assert.equal(runGitAt(stateFolder, 0, ["config", `submodule.${SUBMODULE_PATH}.url`]), SUBMODULE_URL);
    assert.equal(runGitAt(join(stateFolder, SUBMODULE_PATH), 0, ["remote", "get-url", "origin"]), SUBMODULE_URL);
});

test("test_applyOutsideGitRow_submodule_clone_puts_the_git_folder_under_the_state_git_modules_folder", (t) => {
    // Scenario: real `git submodule add` writes a .git file in the submodule that points into the parent's .git/modules.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone row
    applySubmoduleRows(stateFolder, source, 1);
    // the .git file points at the folder, and the folder exists
    assert.equal(readFileSync(join(stateFolder, SUBMODULE_PATH, ".git"), "utf8").trim(), "gitdir: ../../.git/modules/playground/typesafe-checks");
    assert.equal(existsSync(join(stateFolder, ".git", "modules", SUBMODULE_PATH, "HEAD")), true);
});

test("test_applyOutsideGitRow_submodule_pull_fast_forwards_master_and_origin_master", (t) => {
    // Scenario: the clone row, then the pull row.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone and pull rows
    applySubmoduleRows(stateFolder, source, 2);
    // the submodule is at commit 2 on master and origin/master, with a clean work tree and no commit 3
    const submoduleFolder = join(stateFolder, SUBMODULE_PATH);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "HEAD"]), source.commit2);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "master"]), source.commit2);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "origin/master"]), source.commit2);
    assert.equal(runGitAt(submoduleFolder, 0, ["status", "--short"]), "");
    assert.equal(existsSync(join(submoduleFolder, "three.txt")), false);
});

test("test_applyOutsideGitRow_submodule_pull_leaves_the_staged_gitlink_at_the_clone_commit", (t) => {
    // Scenario: a real `git pull` in the submodule does not restage the parent's gitlink.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone and pull rows
    applySubmoduleRows(stateFolder, source, 2);
    // the gitlink still names commit 1, so the parent shows the submodule as added and modified
    assert.equal(runGitAt(stateFolder, 0, ["ls-files", "-s", SUBMODULE_PATH]).startsWith(`160000 ${source.commit1}`), true);
    assert.equal(runGitAt(stateFolder, 0, ["status", "--short"]), `A  .gitmodules\nAM ${SUBMODULE_PATH}`);
});

test("test_applyOutsideGitRow_submodule_commit_moves_master_to_the_commit_and_leaves_origin_master", (t) => {
    // Scenario: the clone, pull and commit rows.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    // apply the clone, pull and commit rows
    applySubmoduleRows(stateFolder, source, 3);
    // the submodule is at commit 3 on master with a clean work tree and index, and origin/master stays at commit 2
    const submoduleFolder = join(stateFolder, SUBMODULE_PATH);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "HEAD"]), source.commit3);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "master"]), source.commit3);
    assert.equal(runGitAt(submoduleFolder, 0, ["rev-parse", "origin/master"]), source.commit2);
    assert.equal(runGitAt(submoduleFolder, 0, ["status", "--short"]), "");
    assert.equal(readFileSync(join(submoduleFolder, "three.txt"), "utf8"), "three.txt");
});

test("test_applyOutsideGitRow_submodule_commit_overwrites_a_work_tree_file_the_commit_changes", (t) => {
    // Scenario: replayed edits left three.txt different from commit 3 before the commit row.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    applySubmoduleRows(stateFolder, source, 2);
    const submoduleFolder = join(stateFolder, SUBMODULE_PATH);
    writeFileSync(join(submoduleFolder, "three.txt"), "replayed edit");
    // apply the commit row
    applyOutsideGitRow(new Path(stateFolder), new Path(source.gitFolder), listSubmoduleRowsOf(source, new Map())[2] as OutsideGitRow);
    // the commit's file content wins, as for a main-repo commit row, and the submodule is clean at commit 3
    assert.equal(readFileSync(join(submoduleFolder, "three.txt"), "utf8"), "three.txt");
    assert.equal(runGitAt(submoduleFolder, 0, ["status", "--short"]), "");
});

test("test_applyOutsideGitRow_submodule_commit_leaves_the_staged_gitlink_and_the_state_HEAD", (t) => {
    // Scenario: a real `git commit` in the submodule does not restage the parent's gitlink.
    const source = makeSubmoduleSource(t);
    const stateFolder = makeStateWithOneCommit(t);
    const headBefore = runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]);
    // apply the clone, pull and commit rows
    applySubmoduleRows(stateFolder, source, 3);
    // the gitlink still names commit 1 and the state HEAD did not move
    assert.equal(runGitAt(stateFolder, 0, ["ls-files", "-s", SUBMODULE_PATH]).startsWith(`160000 ${source.commit1}`), true);
    assert.equal(runGitAt(stateFolder, 0, ["rev-parse", "HEAD"]), headBefore);
});
