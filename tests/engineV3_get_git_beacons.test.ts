import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { getGitBeacons } from "../engineV3/tryToSolvePuzzle.ts";

function runGit(repoFolder: string, gitArguments: string[]): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "user.name=test", "-c", "user.email=test@example.com", ...gitArguments], { encoding: "utf8" }).trim();
}

function writeFileAndCommit(repoFolder: string, relativePath: string, text: string): string {
    writeFileSync(join(repoFolder, relativePath), text);
    runGit(repoFolder, ["add", relativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `write ${relativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

function removeFileAndCommit(repoFolder: string, relativePath: string): string {
    runGit(repoFolder, ["rm", "-q", relativePath]);
    runGit(repoFolder, ["commit", "-q", "-m", `remove ${relativePath}`]);
    return runGit(repoFolder, ["rev-parse", "HEAD"]);
}

test("test_getGitBeacons_lists_create_change_delete_create_newest_first_with_bytes_and_absent_for_the_delete", () => {
    // Scenario: a file is created, changed, deleted, and created again.
    // Steps:
    const repoFolder = mkdtempSync(join(tmpdir(), "engine-v3-git-beacons-"));
    try {
        runGit(repoFolder, ["init", "-q"]);
        // commit one creates a.txt, commit two changes it, commit three deletes it, commit four creates it again.
        const createCommit = writeFileAndCommit(repoFolder, "a.txt", "one\n");
        const changeCommit = writeFileAndCommit(repoFolder, "a.txt", "one\ntwo\n");
        const deleteCommit = removeFileAndCommit(repoFolder, "a.txt");
        const recreateCommit = writeFileAndCommit(repoFolder, "a.txt", "three\n");
        // the beacons are the four commits, newest first, each a GitCommit event.
        const beacons = getGitBeacons(new Path(repoFolder), new Path(join(repoFolder, "a.txt")));
        assert.deepEqual(beacons.map((beacon) => beacon.commitHash!.toString()), [recreateCommit, deleteCommit, changeCommit, createCommit]);
        assert.ok(beacons.every((beacon) => beacon.type === FileEventType.GitCommit));
        // the bytes of each beacon are the file at that commit; the delete commit has no bytes (absent).
        assert.deepEqual(beacons.map((beacon) => beacon.bytes), ["three\n", undefined, "one\ntwo\n", "one\n"]);
    } finally {
        rmSync(repoFolder, { recursive: true, force: true });
    }
});
