// Task 231 (spec S18): readRepoTreeAtRef — the `starting repository state`, every tracked path at a ref relative to the repo root, with submodule gitlinks told apart from blobs.  Fixture is a real temp git repo with two commits so an explicit hash and HEAD have provably different trees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { readRepoTreeAtRef } from "../src/layer1_repo_tree.ts";

// Run a git command in `repoDir` with fixed identity and a pinned committer date; returns stdout.
function runGit(repoDir: string, command: string, committerDate?: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
        cwd: repoDir,
        stdio: "pipe",
        env: {
            ...process.env,
            ...(committerDate === undefined ? {} : { GIT_COMMITTER_DATE: committerDate }),
        },
    }).toString();
}

// A repo whose first commit holds only notes.txt and whose second adds nested/other.txt.
function makeFixtureRepo(): { repoDir: string; firstCommit: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-repo-tree-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, "notes.txt"), "first\n");
    runGit(repoDir, "add notes.txt");
    runGit(repoDir, "commit -q -m one", "2026-07-01T10:00:00Z");
    const firstCommit = runGit(repoDir, "rev-parse HEAD").trim();
    mkdirSync(join(repoDir, "nested"));
    writeFileSync(join(repoDir, "nested", "other.txt"), "second\n");
    runGit(repoDir, "add nested/other.txt");
    runGit(repoDir, "commit -q -m two", "2026-07-02T11:00:00Z");
    return { repoDir, firstCommit };
}

// A repo with one tracked file plus a committed submodule at vendor/lib. The submodule is nested rather than at the root so the exact-match exclusion downstream is proven against a path CONTAINING A SEPARATOR (the real repo has external/tmux_lib). `protocol.file.allow=always` is mandatory: modern git refuses a local-path submodule clone without it.
function makeRepoWithSubmodule(): string {
    const innerDir = mkdtempSync(join(tmpdir(), "layer1-repo-inner-"));
    runGit(innerDir, "init -q");
    writeFileSync(join(innerDir, "inner.txt"), "inner\n");
    runGit(innerDir, "add inner.txt");
    runGit(innerDir, "commit -q -m inner", "2026-07-01T10:00:00Z");
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-repo-outer-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, "kept.txt"), "kept\n");
    runGit(repoDir, "add kept.txt");
    runGit(repoDir, "commit -q -m one", "2026-07-01T11:00:00Z");
    runGit(repoDir, `-c protocol.file.allow=always submodule add -q ${innerDir} vendor/lib`);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m submodule", "2026-07-01T12:00:00Z");
    return repoDir;
}

test("test_readRepoTreeAtRef_defaults_to_the_active_branch_tree", () => {
    // Scenario: called with no ref, the list matches `git ls-tree -r --name-only HEAD` exactly — every tracked path, relative to the repo root, nested ones included.
    const { repoDir } = makeFixtureRepo();
    const expected = runGit(repoDir, "ls-tree -r --name-only HEAD").split("\n").filter((line) => line !== "");
    const tree = readRepoTreeAtRef(new Path(repoDir));
    assert.deepEqual(tree.trackedFiles.map((path) => path.toString()), expected);
    assert.deepEqual(expected, ["nested/other.txt", "notes.txt"]);
});

test("test_readRepoTreeAtRef_reads_an_explicit_commit_tree_not_HEAD", () => {
    // Scenario: the first commit's hash yields THAT commit's tree — notes.txt only; the file added by the second commit must not leak in from HEAD.
    const { repoDir, firstCommit } = makeFixtureRepo();
    const tree = readRepoTreeAtRef(new Path(repoDir), firstCommit);
    assert.deepEqual(tree.trackedFiles.map((path) => path.toString()), ["notes.txt"]);
});

test("test_readRepoTreeAtRef_reads_a_branch_name", () => {
    // Scenario: a branch name resolves like any other ref — a branch pinned at the first commit shows the first commit's tree.
    const { repoDir, firstCommit } = makeFixtureRepo();
    runGit(repoDir, `branch early ${firstCommit}`);
    const tree = readRepoTreeAtRef(new Path(repoDir), "early");
    assert.deepEqual(tree.trackedFiles.map((path) => path.toString()), ["notes.txt"]);
});

test("test_readRepoTreeAtRef_throws_naming_an_invalid_ref", () => {
    // Scenario: an unresolvable ref is a loud error naming the bad ref — never a silent fall back to HEAD, which would show a tree the caller never asked for.
    const { repoDir } = makeFixtureRepo();
    assert.throws(
        () => readRepoTreeAtRef(new Path(repoDir), "no-such-ref"),
        (error: unknown) => error instanceof Error && error.message.includes("no-such-ref"),
    );
});

test("test_readRepoTreeAtRef_separates_submodule_gitlinks_from_tracked_files", () => {
    // Scenario: `git ls-tree -r` recurses trees but stops at a gitlink, emitting the submodule as a bare directory name. Layer 1 must be able to tell the two apart.  Steps: build a repo with one tracked file and one committed submodule.
    const repoDir = makeRepoWithSubmodule();
    // read the tree at HEAD.
    const tree = readRepoTreeAtRef(new Path(repoDir));
    // the blob is a tracked file — .gitmodules is one too, since git really does track it...
    assert.deepEqual(tree.trackedFiles.map((path) => path.toString()), [".gitmodules", "kept.txt"]);
    // ...and the gitlink is reported separately, never as a tracked file.
    assert.deepEqual(tree.submodulePaths.map((path) => path.toString()), ["vendor/lib"]);
});
