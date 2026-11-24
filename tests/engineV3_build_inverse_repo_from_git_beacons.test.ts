import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildInverseRepoFromGitBeacons } from "../engineV3/buildInverseRepoFromGitBeaconsMain.ts";

function runGit(repoFolder: string, gitArguments: string[]): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "user.name=test", "-c", "user.email=test@example.com", ...gitArguments], { encoding: "utf8" }).trim();
}

function writeFileAndCommit(repoFolder: string, relativePath: string, text: string): string {
    writeFileSync(join(repoFolder, relativePath), text);
    runGit(repoFolder, ["add", relativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `write ${relativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

test("test_buildInverseRepoFromGitBeacons_writes_the_disk_state_then_the_git_beacons_newest_first", () => {
    // Scenario: a file is created, changed, and changed again on disk without a commit.
    // Steps:
    const gitFolder = mkdtempSync(join(tmpdir(), "engine-v3-beacons-only-git-"));
    const storeFolder = mkdtempSync(join(tmpdir(), "engine-v3-beacons-only-store-"));
    try {
        runGit(gitFolder, ["init", "-q"]);
        // commit one creates a.txt, commit two changes it, then the disk is changed without a commit.
        writeFileAndCommit(gitFolder, "a.txt", "one\n");
        writeFileAndCommit(gitFolder, "a.txt", "one\ntwo\n");
        writeFileSync(join(gitFolder, "a.txt"), "one\ntwo\nthree on disk\n");
        // build the inverse repo of a.txt from the beacons only.
        const inverseRepoFolder = new Path(join(storeFolder, "a.txt.git"));
        buildInverseRepoFromGitBeacons(inverseRepoFolder, new Path(gitFolder), new Path(join(gitFolder, "a.txt")), new Date());
        // commit 0 is the on-disk state; commit 1 and 2 are the git beacons, newest first.
        const inverseCommits = listInverseCommits(inverseRepoFolder, "a.txt");
        assert.deepEqual(inverseCommits.map((inverseCommit) => inverseCommit.position), [0, 1, 2]);
        assert.deepEqual(inverseCommits.map((inverseCommit) => inverseCommit.eventType), [FileEventType.DiskNow, FileEventType.GitCommit, FileEventType.GitCommit]);
        // the bytes are the file on disk, the changed text, and the created text.
        assert.deepEqual(inverseCommits.map((inverseCommit) => inverseCommit.text), ["one\ntwo\nthree on disk\n", "one\ntwo\n", "one\n"]);
    } finally {
        rmSync(gitFolder, { recursive: true, force: true });
        rmSync(storeFolder, { recursive: true, force: true });
    }
});

test("test_buildInverseRepoFromGitBeacons_writes_the_absent_state_as_commit_zero_for_a_file_not_on_disk", () => {
    // Scenario: a file is created, then deleted by a commit; it is not on disk now.
    // Steps:
    const gitFolder = mkdtempSync(join(tmpdir(), "engine-v3-beacons-only-git-"));
    const storeFolder = mkdtempSync(join(tmpdir(), "engine-v3-beacons-only-store-"));
    try {
        runGit(gitFolder, ["init", "-q"]);
        writeFileAndCommit(gitFolder, "a.txt", "one\n");
        runGit(gitFolder, ["rm", "-q", "a.txt"]);
        runGit(gitFolder, ["commit", "-q", "-m", "remove a.txt"]);
        // build the inverse repo of a.txt.
        const inverseRepoFolder = new Path(join(storeFolder, "a.txt.git"));
        buildInverseRepoFromGitBeacons(inverseRepoFolder, new Path(gitFolder), new Path(join(gitFolder, "a.txt")), new Date());
        // commit 0 is absent (on-disk state), commit 1 is the delete commit (absent), commit 2 is the created text.
        const inverseCommits = listInverseCommits(inverseRepoFolder, "a.txt");
        assert.deepEqual(inverseCommits.map((inverseCommit) => inverseCommit.isFileAbsent), [true, true, false]);
        assert.deepEqual(inverseCommits.map((inverseCommit) => inverseCommit.text), [undefined, undefined, "one\n"]);
    } finally {
        rmSync(gitFolder, { recursive: true, force: true });
        rmSync(storeFolder, { recursive: true, force: true });
    }
});
