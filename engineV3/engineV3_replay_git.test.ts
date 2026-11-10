import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import { copyRepoIntoState,moveBranchesToCommitTime } from "./engineV3_replay_git.ts";

type BranchedRepo = { gitFolder: string; commit1: string; commit2: string; commit3: string };

function runGitWithDate(folder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8", env }).trim();
}

function commitFile(folder: string, isoDate: string, fileName: string): string {
    writeFileSync(join(folder, fileName), fileName);
    runGitWithDate(folder, isoDate, ["add", "-A"]);
    runGitWithDate(folder, isoDate, ["commit", "-q", "-m", fileName]);
    return runGitWithDate(folder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// Commit 1 on main at 10s, commit 2 on side at 20s, commit 3 on main at 30s.
function makeBranchedRepo(t: TestContext): BranchedRepo {
    const workFolder = makeTempFolder(t, "engine-v3-git-source-");
    runGitWithDate(workFolder, "2026-01-01T00:00:10Z", ["init", "-q", "-b", "main"]);
    const commit1 = commitFile(workFolder, "2026-01-01T00:00:10Z", "a.txt");
    runGitWithDate(workFolder, "2026-01-01T00:00:15Z", ["checkout", "-q", "-b", "side"]);
    const commit2 = commitFile(workFolder, "2026-01-01T00:00:20Z", "b.txt");
    runGitWithDate(workFolder, "2026-01-01T00:00:25Z", ["checkout", "-q", "main"]);
    const commit3 = commitFile(workFolder, "2026-01-01T00:00:30Z", "c.txt");
    return { gitFolder: join(workFolder, ".git"), commit1, commit2, commit3 };
}

function makeClonedState(t: TestContext, repos: BranchedRepo): string {
    const stateFolder = makeTempFolder(t, "engine-v3-git-state-");
    copyRepoIntoState(new Path(repos.gitFolder), new Path(stateFolder));
    return stateFolder;
}

function readGit(stateFolder: string, args: string[]): string {
    return execFileSync("git", args, { cwd: stateFolder, encoding: "utf8" }).trim();
}

test("test_copyRepoIntoState_makes_a_git_folder_with_no_work_files", (t) => {
    // Scenario: the clone puts only .git into the empty state folder.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeTempFolder(t, "engine-v3-git-state-");
    // clone the copied repo into the state folder
    copyRepoIntoState(new Path(repos.gitFolder), new Path(stateFolder));
    // the state folder holds only .git
    assert.deepEqual(readdirSync(stateFolder), [".git"]);
});

test("test_moveBranchesToCommitTime_drops_a_branch_that_did_not_exist_yet", (t) => {
    // Scenario: at commit 1 the side branch is not made yet, so the state folder has no side branch.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeClonedState(t, repos);
    // the state folder has a side branch before the move, as an earlier move would leave it
    readGit(stateFolder, ["branch", "side", repos.commit2]);
    assert.match(readGit(stateFolder, ["branch", "--list", "side"]), /side/);
    // move to commit 1
    moveBranchesToCommitTime(new Path(stateFolder), new Path(repos.gitFolder), new Uuid(repos.commit1));
    // the side branch is gone
    assert.equal(readGit(stateFolder, ["branch", "--list", "side"]), "");
});

test("test_moveBranchesToCommitTime_points_HEAD_at_the_branch_that_made_the_commit", (t) => {
    // Scenario: commit 2 was made on side, so HEAD names side.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeClonedState(t, repos);
    // move to commit 2
    moveBranchesToCommitTime(new Path(stateFolder), new Path(repos.gitFolder), new Uuid(repos.commit2));
    // HEAD names side
    assert.equal(readGit(stateFolder, ["symbolic-ref", "HEAD"]), "refs/heads/side");
});

test("test_moveBranchesToCommitTime_sets_each_branch_to_its_value_at_that_time", (t) => {
    // Scenario: at commit 2, main is still commit 1 and side is commit 2.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeClonedState(t, repos);
    // move to commit 2
    moveBranchesToCommitTime(new Path(stateFolder), new Path(repos.gitFolder), new Uuid(repos.commit2));
    // main is commit 1, side is commit 2
    assert.equal(readGit(stateFolder, ["rev-parse", "refs/heads/main"]), repos.commit1);
    assert.equal(readGit(stateFolder, ["rev-parse", "refs/heads/side"]), repos.commit2);
});

test("test_moveBranchesToCommitTime_makes_the_index_match_the_commit", (t) => {
    // Scenario: after commit 2 is applied and the move is done, git status shows no change.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeClonedState(t, repos);
    const state = new Path(stateFolder);
    const repoPath = new Path(repos.gitFolder);
    // apply commits 1 and 2 to the state folder
    applyCommitToState(new Uuid(repos.commit1), state, repoPath);
    applyCommitToState(new Uuid(repos.commit2), state, repoPath);
    // move to commit 2
    moveBranchesToCommitTime(state, repoPath, new Uuid(repos.commit2));
    // git status is clean
    assert.equal(readGit(stateFolder, ["status", "--porcelain"]), "");
});

test("test_moveBranchesToCommitTime_throws_for_a_commit_not_in_the_HEAD_log", (t) => {
    // Scenario: a commit the HEAD log never names makes the move throw, naming the commit.
    const repos = makeBranchedRepo(t);
    const stateFolder = makeClonedState(t, repos);
    const unknownCommit = "1".repeat(40);
    // the move throws and names the commit
    assert.throws(() => moveBranchesToCommitTime(new Path(stateFolder), new Path(repos.gitFolder), new Uuid(unknownCommit)), new RegExp(unknownCommit));
});

test("test_copyRepoIntoState_reads_a_commit_that_only_the_HEAD_log_names", (t) => {
    // Scenario: commit B was reset away, so only logs/HEAD names it; the state must still hold its object.
    const workFolder = makeTempFolder(t, "engine-v3-git-lost-");
    runGitWithDate(workFolder, "2026-01-01T00:00:10Z", ["init", "-q", "-b", "main"]);
    const commitA = commitFile(workFolder, "2026-01-01T00:00:10Z", "a.txt");
    const commitB = commitFile(workFolder, "2026-01-01T00:00:20Z", "b.txt");
    // reset to A, then make commit C, so B is no longer reachable
    runGitWithDate(workFolder, "2026-01-01T00:00:25Z", ["reset", "-q", "--hard", commitA]);
    commitFile(workFolder, "2026-01-01T00:00:30Z", "c.txt");
    // copy the .git folder into the state folder
    const stateFolder = makeTempFolder(t, "engine-v3-git-state-");
    copyRepoIntoState(new Path(join(workFolder, ".git")), new Path(stateFolder));
    // the state folder can read commit B (cat-file exits 0)
    readGit(stateFolder, ["cat-file", "-e", commitB]);
});
