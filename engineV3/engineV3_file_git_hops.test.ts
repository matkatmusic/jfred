import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { listGitHopsForFile } from "./engineV3_file_git_hops.ts";

const FILE_TEXT = "echo one\necho two\necho three\necho four\n";

function runGit(repoFolder: string, gitArguments: string[]): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "user.name=test", "-c", "user.email=test@example.com", ...gitArguments], { encoding: "utf8" }).trim();
}

function createRepoFolder(): string {
    const repoFolder = mkdtempSync(join(tmpdir(), "engine-v3-git-hops-"));
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

function removeFileAndCommit(repoFolder: string, relativePath: string): string {
    runGit(repoFolder, ["rm", "-q", relativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `remove ${relativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

test("test_listGitHopsForFile_gives_the_adding_commit_and_the_editing_commit_oldest_first", () => {
    // Scenario: a file is added, then edited, and an unrelated file is added between them.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds a.txt, commit two adds b.txt, commit three edits a.txt.
        const addCommit = writeFileAndCommit(repoFolder, "a.txt", FILE_TEXT);
        writeFileAndCommit(repoFolder, "b.txt", "other\n");
        const editCommit = writeFileAndCommit(repoFolder, "a.txt", `${FILE_TEXT}echo five\n`);
        // the list holds commit one then commit three, with the path a.txt and no delete.
        const aPath = new Path(join(repoFolder, "a.txt"));
        assert.deepEqual(listGitHopsForFile(new Path(repoFolder), aPath), [
            { commit: addCommit, pathAtCommit: aPath, isDelete: false },
            { commit: editCommit, pathAtCommit: aPath, isDelete: false },
        ]);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_listGitHopsForFile_follows_a_rename_and_gives_the_new_path_at_the_rename_commit", () => {
    // Scenario: a file is added at one path and moved to another path.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds old.sh, commit two moves it to new.sh.
        const addCommit = writeFileAndCommit(repoFolder, "old.sh", FILE_TEXT);
        const moveCommit = moveFileAndCommit(repoFolder, "old.sh", "new.sh");
        // asking for new.sh gives the add at old.sh and the move at new.sh.
        assert.deepEqual(listGitHopsForFile(new Path(repoFolder), new Path(join(repoFolder, "new.sh"))), [
            { commit: addCommit, pathAtCommit: new Path(join(repoFolder, "old.sh")), isDelete: false },
            { commit: moveCommit, pathAtCommit: new Path(join(repoFolder, "new.sh")), isDelete: false },
        ]);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_listGitHopsForFile_marks_the_commit_that_deletes_the_file", () => {
    // Scenario: a file is added, moved to TO_DELETE, then removed.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // commit one adds old.sh, commit two moves it to TO_DELETE/old.sh, commit three removes it.
        const addCommit = writeFileAndCommit(repoFolder, "old.sh", FILE_TEXT);
        const moveCommit = moveFileAndCommit(repoFolder, "old.sh", "TO_DELETE/old.sh");
        const removeCommit = removeFileAndCommit(repoFolder, "TO_DELETE/old.sh");
        // asking for the deleted path gives three commits and only the last one is a delete.
        const trashPath = new Path(join(repoFolder, "TO_DELETE/old.sh"));
        assert.deepEqual(listGitHopsForFile(new Path(repoFolder), trashPath), [
            { commit: addCommit, pathAtCommit: new Path(join(repoFolder, "old.sh")), isDelete: false },
            { commit: moveCommit, pathAtCommit: trashPath, isDelete: false },
            { commit: removeCommit, pathAtCommit: trashPath, isDelete: true },
        ]);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});

test("test_listGitHopsForFile_gives_an_empty_list_for_a_path_that_never_existed", () => {
    // Scenario: no commit ever held the path.
    // Steps:
    const repoFolder = createRepoFolder();
    try {
        // one commit holds a.txt only.
        writeFileAndCommit(repoFolder, "a.txt", "one\n");
        // the list for nothing.txt is empty.
        assert.deepEqual(listGitHopsForFile(new Path(repoFolder), new Path(join(repoFolder, "nothing.txt"))), []);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});
