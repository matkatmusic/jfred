import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { getFileCreationCommit } from "./engineV3_file_creation_commit.ts";

function runGit(repoFolder: string, gitArguments: string[]): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "user.name=test", "-c", "user.email=test@example.com", ...gitArguments], { encoding: "utf8" }).trim();
}

function createRepoFolder(): string {
    const repoFolder = mkdtempSync(join(tmpdir(), "engine-v3-creation-commit-"));
    runGit(repoFolder, ["init", "-q"]);
    return repoFolder;
}

function writeFileAndCommit(repoFolder: string, relativePath: string, text: string): string {
    mkdirSync(dirname(join(repoFolder, relativePath)), { recursive: true });
    writeFileSync(join(repoFolder, relativePath), text);
    runGit(repoFolder, ["add", relativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `write ${relativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

function moveFileAndCommit(repoFolder: string, fromRelativePath: string, toRelativePath: string): string {
    mkdirSync(dirname(join(repoFolder, toRelativePath)), { recursive: true });
    runGit(repoFolder, ["mv", fromRelativePath, toRelativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `move ${fromRelativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

test("test_getFileCreationCommit_gives_the_commit_that_added_a_file_that_never_moved", () => {
    // Scenario: a file is added once and edited once, and the start commit is after the edit.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds the file, commit two edits it.
        const creationCommit = writeFileAndCommit(repoFolder, "a.txt", "one\nline two\nline three\n");
        const startCommit = writeFileAndCommit(repoFolder, "a.txt", "one\nline two\nline three\nfour\n");
        // the answer is commit one and the same path.
        const result = getFileCreationCommit(new Path(repoFolder), startCommit, new Path(join(repoFolder, "a.txt")));
        assert.deepEqual(result, { commit: creationCommit, pathAtCreation: new Path(join(repoFolder, "a.txt")) });
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_getFileCreationCommit_follows_a_rename_back_to_the_old_path", () => {
    // Scenario: a file is added at one path and moved to another path before the start commit.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds scripts/git.sh, commit two moves it to TO_DELETE/scripts/git.sh.
        const creationCommit = writeFileAndCommit(repoFolder, "scripts/git.sh", "echo one\necho two\necho three\necho four\n");
        const startCommit = moveFileAndCommit(repoFolder, "scripts/git.sh", "TO_DELETE/scripts/git.sh");
        // asking for the new path gives commit one and the old path.
        const result = getFileCreationCommit(new Path(repoFolder), startCommit, new Path(join(repoFolder, "TO_DELETE/scripts/git.sh")));
        assert.deepEqual(result, { commit: creationCommit, pathAtCreation: new Path(join(repoFolder, "scripts/git.sh")) });
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_getFileCreationCommit_finds_a_file_that_is_deleted_before_the_start_commit", () => {
    // Scenario: a file is added, moved, then deleted, and the start commit is after the delete.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds old.sh, commit two moves it to TO_DELETE/old.sh, commit three removes it.
        const creationCommit = writeFileAndCommit(repoFolder, "old.sh", "echo one\necho two\necho three\necho four\n");
        moveFileAndCommit(repoFolder, "old.sh", "TO_DELETE/old.sh");
        runGit(repoFolder, ["rm", "-q", "TO_DELETE/old.sh"]);
        runGit(repoFolder, ["commit", "-q", "-m", "remove the trash"]);
        const startCommit = runGit(repoFolder, ["rev-parse", "HEAD"]);
        // asking for the deleted path still gives commit one and the first path.
        const result = getFileCreationCommit(new Path(repoFolder), startCommit, new Path(join(repoFolder, "TO_DELETE/old.sh")));
        assert.deepEqual(result, { commit: creationCommit, pathAtCreation: new Path(join(repoFolder, "old.sh")) });
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_getFileCreationCommit_gives_undefined_for_a_file_added_after_the_start_commit", () => {
    // Scenario: the file is added by a commit that comes after the start commit.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one is the start commit, commit two adds later.txt.
        const startCommit = writeFileAndCommit(repoFolder, "a.txt", "one\n");
        writeFileAndCommit(repoFolder, "later.txt", "later\n");
        // the answer is undefined.
        assert.equal(getFileCreationCommit(new Path(repoFolder), startCommit, new Path(join(repoFolder, "later.txt"))), undefined);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_getFileCreationCommit_gives_undefined_for_a_path_that_never_existed", () => {
    // Scenario: no commit ever held the path.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // one commit holds a.txt only.
        const startCommit = writeFileAndCommit(repoFolder, "a.txt", "one\n");
        // the answer for nothing.txt is undefined.
        assert.equal(getFileCreationCommit(new Path(repoFolder), startCommit, new Path(join(repoFolder, "nothing.txt"))), undefined);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});
