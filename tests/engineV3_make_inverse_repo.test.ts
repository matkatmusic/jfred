import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
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
