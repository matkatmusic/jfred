import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHECKOUT_FOLDER_PREFIX, runReplay, checkOutRepoAt, applyCommitToState, getChildCommitTowards, isCommitAtOrBefore, CommitHash, JSONLLine } from "./engineV3.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
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
