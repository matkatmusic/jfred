// Task 231 (spec S18): listRepoTreeAtRef — the `starting repository state`, every tracked
// path at a ref relative to the repo root. Fixture is a real temp git repo with two commits
// so an explicit hash and HEAD have provably different trees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { listRepoTreeAtRef } from "../src/layer1_repo_tree.ts";

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

test("test_listRepoTreeAtRef_defaults_to_the_active_branch_tree", () => {
    // Scenario: called with no ref, the list matches `git ls-tree -r --name-only HEAD` exactly —
    // every tracked path, relative to the repo root, nested ones included.
    const { repoDir } = makeFixtureRepo();
    const expected = runGit(repoDir, "ls-tree -r --name-only HEAD").split("\n").filter((line) => line !== "");
    const paths = listRepoTreeAtRef(new Path(repoDir));
    assert.deepEqual(paths.map((path) => path.toString()), expected);
    assert.deepEqual(expected, ["nested/other.txt", "notes.txt"]);
});

test("test_listRepoTreeAtRef_reads_an_explicit_commit_tree_not_HEAD", () => {
    // Scenario: the first commit's hash yields THAT commit's tree — notes.txt only; the file
    // added by the second commit must not leak in from HEAD.
    const { repoDir, firstCommit } = makeFixtureRepo();
    const paths = listRepoTreeAtRef(new Path(repoDir), firstCommit);
    assert.deepEqual(paths.map((path) => path.toString()), ["notes.txt"]);
});

test("test_listRepoTreeAtRef_reads_a_branch_name", () => {
    // Scenario: a branch name resolves like any other ref — a branch pinned at the first commit
    // shows the first commit's tree.
    const { repoDir, firstCommit } = makeFixtureRepo();
    runGit(repoDir, `branch early ${firstCommit}`);
    const paths = listRepoTreeAtRef(new Path(repoDir), "early");
    assert.deepEqual(paths.map((path) => path.toString()), ["notes.txt"]);
});

test("test_listRepoTreeAtRef_throws_naming_an_invalid_ref", () => {
    // Scenario: an unresolvable ref is a loud error naming the bad ref — never a silent fall
    // back to HEAD, which would show a tree the caller never asked for.
    const { repoDir } = makeFixtureRepo();
    assert.throws(
        () => listRepoTreeAtRef(new Path(repoDir), "no-such-ref"),
        (error: unknown) => error instanceof Error && error.message.includes("no-such-ref"),
    );
});
