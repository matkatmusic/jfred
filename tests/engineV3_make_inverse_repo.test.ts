import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Path } from "../src/structures/domain.ts";
import { runJfredGit } from "../src/viewer_api_layer1_jfred_git.ts";
import { makeInverseRepo } from "../engineV3/engineV3_make_inverse_repo.ts";

const SCENARIO_REPO_TAR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scenarios", "executed", "s84-multiagent-scripts-git-baseline", "repo.git.tar");
const GIT_IDENTITY_ENV = { GIT_AUTHOR_NAME: "s", GIT_AUTHOR_EMAIL: "s@example.com", GIT_COMMITTER_NAME: "s", GIT_COMMITTER_EMAIL: "s@example.com" };

type Fixture = { sourceRepo: Path; inverseRepo: Path; reconstructedCopy: Path };
let cachedFixture: Fixture | undefined;

function runGit(repoFolder: string, gitArguments: string[], env: Record<string, string> = {}): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "commit.gpgsign=false", ...gitArguments], { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function getAt<T>(items: T[], index: number): T {
    const item = items[index];
    if (item === undefined) {
        throw new Error(`getAt: no item at index ${index} of ${items.length}`);
    }
    return item;
}

// The scenario tar is copied into a new temp folder first: nothing is extracted inside the scenarios folder.
function extractScenarioRepo(): Path {
    const repoFolder = mkdtempSync(join(tmpdir(), "make-inverse-source-"));
    copyFileSync(SCENARIO_REPO_TAR, join(repoFolder, "repo.git.tar"));
    execFileSync("tar", ["-xf", "repo.git.tar"], { cwd: repoFolder });
    return new Path(repoFolder);
}

function getFixture(): Fixture {
    if (cachedFixture === undefined) {
        const sourceRepo = extractScenarioRepo();
        const inverseRepo = makeInverseRepo(sourceRepo);
        const reconstructedCopy = makeInverseRepo(inverseRepo);
        cachedFixture = { sourceRepo, inverseRepo, reconstructedCopy };
    }
    return cachedFixture;
}

function listCommitHashesOldestFirst(repo: Path): string[] {
    return runJfredGit(repo, ["log", "--reverse", "--format=%H", "HEAD"]).split("\n");
}

function listTreeHashesOldestFirst(repo: Path): string[] {
    return runJfredGit(repo, ["log", "--reverse", "--format=%T", "HEAD"]).split("\n");
}

function getEmptyTreeHash(repo: Path): string {
    return runJfredGit(repo, ["mktree"], { input: "" });
}

function listChangedFileNames(repo: Path, commitHash: string): string[] {
    return runJfredGit(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commitHash]).split("\n").filter((name) => name !== "");
}

test("test_the_first_inverse_commit_has_the_tree_of_the_source_head", () => {
    // Scenario: commit 0 of the inverse repo holds the state of the source repo at HEAD.
    // Steps:
    const { sourceRepo, inverseRepo } = getFixture();
    // read the tree of the source HEAD.
    const sourceHeadTree = runJfredGit(sourceRepo, ["rev-parse", "HEAD^{tree}"]);
    // read the tree of the oldest inverse commit.
    const firstInverseTree = getAt(listTreeHashesOldestFirst(inverseRepo), 0);
    // the two trees are the same.
    assert.equal(firstInverseTree, sourceHeadTree);
});

test("test_each_inverse_commit_diff_is_the_reversed_diff_of_its_source_commit_file_by_file", () => {
    // Scenario: the inverse commit of source commit i has the exact opposite diff of source commit i.
    // Steps:
    const { sourceRepo, inverseRepo } = getFixture();
    const sourceHashes = listCommitHashesOldestFirst(sourceRepo);
    const inverseHashes = listCommitHashesOldestFirst(inverseRepo);
    for (const [sourceIndex, sourceHash] of sourceHashes.entries()) {
        // the inverse commit of source commit i sits at position (count - i) in the inverse list.
        const inverseHash = getAt(inverseHashes, sourceHashes.length - sourceIndex);
        // both commits change the same files.
        const sourceNames = listChangedFileNames(sourceRepo, sourceHash);
        assert.deepEqual(listChangedFileNames(inverseRepo, inverseHash), sourceNames, `files of ${sourceHash}`);
        for (const fileName of sourceNames) {
            // the inverse patch of the file equals the source patch read backwards (git diff -R).
            const reversedSourcePatch = runJfredGit(sourceRepo, ["diff-tree", "-p", "-R", "--src-prefix=b/", "--dst-prefix=a/", "--no-commit-id", "--root", sourceHash, "--", fileName]);
            const inversePatch = runJfredGit(inverseRepo, ["diff-tree", "-p", "--no-commit-id", "--root", inverseHash, "--", fileName]);
            assert.equal(inversePatch, reversedSourcePatch, `${fileName} of ${sourceHash}`);
        }
    }
});

test("test_the_last_inverse_commit_has_the_empty_tree", () => {
    // Scenario: the revert of the first source commit leaves no files.
    // Steps:
    const { inverseRepo } = getFixture();
    // read the tree of the newest inverse commit.
    const lastInverseTree = runJfredGit(inverseRepo, ["rev-parse", "HEAD^{tree}"]);
    // it is the empty tree.
    assert.equal(lastInverseTree, getEmptyTreeHash(inverseRepo));
});

test("test_each_inverse_commit_message_names_the_source_commit_hash_and_subject", () => {
    // Scenario: the paper trail of an inverse commit says which source commit it reverts.
    // Steps:
    const { sourceRepo, inverseRepo } = getFixture();
    const sourceHashes = listCommitHashesOldestFirst(sourceRepo);
    const inverseHashes = listCommitHashesOldestFirst(inverseRepo);
    for (const [sourceIndex, sourceHash] of sourceHashes.entries()) {
        // read the message of the inverse commit of source commit i.
        const message = runJfredGit(inverseRepo, ["log", "-1", "--format=%B", getAt(inverseHashes, sourceHashes.length - sourceIndex)]);
        // it holds the source hash and the source subject.
        const sourceSubject = runJfredGit(sourceRepo, ["log", "-1", "--format=%s", sourceHash]);
        assert.ok(message.includes(sourceHash), `hash of ${sourceHash}`);
        assert.ok(message.includes(sourceSubject), `subject of ${sourceHash}`);
    }
});

test("test_the_round_trip_copy_holds_every_source_tree_in_order_with_one_empty_tree_before_and_one_after", () => {
    // Scenario: makeInverseRepo(makeInverseRepo(source)) is not equal to the source: it has two extra empty-tree commits.
    // Steps:
    const { sourceRepo, reconstructedCopy } = getFixture();
    const sourceTrees = listTreeHashesOldestFirst(sourceRepo);
    const copyTrees = listTreeHashesOldestFirst(reconstructedCopy);
    const emptyTree = getEmptyTreeHash(reconstructedCopy);
    // the source has N commits and the copy has N + 2.
    assert.equal(copyTrees.length, sourceTrees.length + 2);
    // the copy is: empty tree, every source tree oldest first, empty tree.
    assert.deepEqual(copyTrees, [emptyTree, ...sourceTrees, emptyTree]);
});

test("test_a_source_commit_with_two_parents_throws", () => {
    // Scenario: only linear history is supported.
    // Steps:
    // make a repo with two commits.
    const repoFolder = mkdtempSync(join(tmpdir(), "make-inverse-merge-"));
    runGit(repoFolder, ["init", "-q"]);
    runGit(repoFolder, ["commit", "-q", "--allow-empty", "-m", "first"], GIT_IDENTITY_ENV);
    const firstHash = runGit(repoFolder, ["rev-parse", "HEAD"]);
    runGit(repoFolder, ["commit", "-q", "--allow-empty", "-m", "second"], GIT_IDENTITY_ENV);
    const secondHash = runGit(repoFolder, ["rev-parse", "HEAD"]);
    // add a commit with both as parents.
    const treeHash = runGit(repoFolder, ["rev-parse", "HEAD^{tree}"]);
    const mergeHash = runGit(repoFolder, ["commit-tree", treeHash, "-p", secondHash, "-p", firstHash, "-m", "merge"], GIT_IDENTITY_ENV);
    runGit(repoFolder, ["update-ref", "HEAD", mergeHash]);
    // the function throws.
    assert.throws(() => makeInverseRepo(new Path(repoFolder)), /2 parents/);
});

type DeletedFileStep = { subject: string; writes: Record<string, string>; removes: string[] };

// The user's example: A is on disk at HEAD; B is created, changed, then removed.
const DELETED_FILE_STEPS: DeletedFileStep[] = [
    { subject: "initial commit", writes: { ".gitignore": "node_modules\n" }, removes: [] },
    { subject: "A created, B created", writes: { "A.txt": "A one\n", "B.txt": "B one\n" }, removes: [] },
    { subject: "A changed", writes: { "A.txt": "A two\n" }, removes: [] },
    { subject: "B changed", writes: { "B.txt": "B two, longer\n" }, removes: [] },
    { subject: "B removed", writes: {}, removes: ["B.txt"] },
    { subject: "A changed again", writes: { "A.txt": "A three\n" }, removes: [] },
];

function buildDeletedFileRepo(): Path {
    const repoFolder = mkdtempSync(join(tmpdir(), "make-inverse-deleted-"));
    runGit(repoFolder, ["init", "-q"]);
    for (const [index, step] of DELETED_FILE_STEPS.entries()) {
        for (const [fileName, text] of Object.entries(step.writes)) {
            writeFileSync(join(repoFolder, fileName), text);
        }
        for (const fileName of step.removes) {
            rmSync(join(repoFolder, fileName));
        }
        runGit(repoFolder, ["add", "-A"]);
        const dateText = `${1_700_000_000 + index * 60} +0000`;
        runGit(repoFolder, ["commit", "-q", "-m", step.subject], { ...GIT_IDENTITY_ENV, GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_DATE: dateText });
    }
    return new Path(repoFolder);
}

function listFileNamesOfCommit(repo: Path, commitHash: string): string[] {
    return runJfredGit(repo, ["ls-tree", "-r", "--name-only", commitHash]).split("\n").filter((name) => name !== "");
}

function readFileBytesAtCommit(repo: Path, commitHash: string, fileName: string): string {
    return runJfredGit(repo, ["cat-file", "-p", `${commitHash}:${fileName}`]);
}

test("test_the_inverse_repo_of_file_A_has_one_commit_per_source_commit_that_changes_A_plus_the_base", () => {
    // Scenario: the inverse repo of file A keeps only the source commits that change A.
    // Steps:
    const sourceRepo = buildDeletedFileRepo();
    // count the source commits that change A.
    const sourceCommitsChangingA = runJfredGit(sourceRepo, ["log", "--format=%H", "HEAD", "--", "A.txt"]).split("\n").length;
    // make the inverse repo of A.
    const inverseRepo = makeInverseRepo(sourceRepo, new Path("A.txt"));
    // the inverse repo has 1 + that many commits.
    assert.equal(listCommitHashesOldestFirst(inverseRepo).length, 1 + sourceCommitsChangingA);
});

test("test_the_last_inverse_commit_of_file_A_has_the_empty_tree", () => {
    // Scenario: the revert of the creation of A leaves no files.
    // Steps:
    const inverseRepo = makeInverseRepo(buildDeletedFileRepo(), new Path("A.txt"));
    assert.equal(runJfredGit(inverseRepo, ["rev-parse", "HEAD^{tree}"]), getEmptyTreeHash(inverseRepo));
});

test("test_no_inverse_commit_of_file_A_holds_B_or_gitignore", () => {
    // Scenario: every tree of the inverse repo of A holds only A.
    // Steps:
    const inverseRepo = makeInverseRepo(buildDeletedFileRepo(), new Path("A.txt"));
    for (const commitHash of listCommitHashesOldestFirst(inverseRepo)) {
        for (const fileName of listFileNamesOfCommit(inverseRepo, commitHash)) {
            assert.equal(fileName, "A.txt", `file in ${commitHash}`);
        }
    }
});

test("test_the_first_inverse_commit_of_file_B_has_the_empty_tree_because_B_is_absent_at_head", () => {
    // Scenario: B was removed before HEAD, so commit 0 holds no file.
    // Steps:
    const inverseRepo = makeInverseRepo(buildDeletedFileRepo(), new Path("B.txt"));
    assert.equal(getAt(listTreeHashesOldestFirst(inverseRepo), 0), getEmptyTreeHash(inverseRepo));
});

test("test_the_second_inverse_commit_of_file_B_holds_B_with_the_bytes_from_before_the_removal", () => {
    // Scenario: the revert of "B removed" brings B back.
    // Steps:
    const inverseRepo = makeInverseRepo(buildDeletedFileRepo(), new Path("B.txt"));
    const commitOne = getAt(listCommitHashesOldestFirst(inverseRepo), 1);
    assert.deepEqual(listFileNamesOfCommit(inverseRepo, commitOne), ["B.txt"]);
    assert.equal(readFileBytesAtCommit(inverseRepo, commitOne, "B.txt"), "B two, longer");
});

test("test_the_last_inverse_commit_of_file_B_has_the_empty_tree", () => {
    // Scenario: the revert of the creation of B removes B.
    // Steps:
    const inverseRepo = makeInverseRepo(buildDeletedFileRepo(), new Path("B.txt"));
    assert.equal(runJfredGit(inverseRepo, ["rev-parse", "HEAD^{tree}"]), getEmptyTreeHash(inverseRepo));
});

test("test_the_message_of_the_second_inverse_commit_of_file_B_names_the_hash_of_the_B_removed_commit", () => {
    // Scenario: the paper trail of the revert of "B removed".
    // Steps:
    const sourceRepo = buildDeletedFileRepo();
    const removalHash = runJfredGit(sourceRepo, ["log", "-1", "--format=%H", "--grep=^B removed$", "HEAD"]);
    const inverseRepo = makeInverseRepo(sourceRepo, new Path("B.txt"));
    const commitOne = getAt(listCommitHashesOldestFirst(inverseRepo), 1);
    const message = runJfredGit(inverseRepo, ["log", "-1", "--format=%B", commitOne]);
    assert.ok(message.includes(removalHash), message);
    assert.ok(message.includes("B removed"), message);
});
