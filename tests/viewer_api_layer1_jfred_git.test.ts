// Task 361: the jfred git runner writes only to its given repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { runJfredGit } from "../src/viewer_api_layer1_jfred_git.ts";
import { Path } from "../src/structures/domain.ts";
import { createJfredTempRepo, runWithHostileGitEnvironment, snapshotRepoState } from "./jfred-write-test-helpers.ts";

function readGitText(repoDir: string, args: string[]): string {
    return execFileSync("git", ["--no-optional-locks", ...args], { cwd: repoDir, encoding: "utf8" });
}

test("test_runJfredGit_write_lands_only_in_the_temp_repo", () => {
    // Two temp repos: A takes the write, B is the decoy.
    const repoA = createJfredTempRepo().repoDir;
    const decoyRepoB = createJfredTempRepo().repoDir;
    // record B's whole state and A's head, status and index mtime before the write.
    const decoyStateBefore = snapshotRepoState(decoyRepoB);
    const headBefore = readGitText(repoA, ["rev-parse", "HEAD"]);
    const statusBefore = readGitText(repoA, ["status", "--porcelain"]);
    const indexMtimeBefore = statSync(join(repoA, ".git", "index")).mtimeMs;
    // run the write under the hostile environment.
    runWithHostileGitEnvironment(decoyRepoB, () => {
        runJfredGit(new Path(repoA), ["update-ref", "refs/heads/probe", "HEAD"]);
    });
    // A lists the new ref.
    assert.ok(readGitText(repoA, ["for-each-ref", "refs/heads/probe"]).includes("refs/heads/probe"));
    // B is byte-equal to before.
    assert.equal(snapshotRepoState(decoyRepoB), decoyStateBefore);
    // A's head, status and index mtime are unchanged.
    assert.equal(readGitText(repoA, ["rev-parse", "HEAD"]), headBefore);
    assert.equal(readGitText(repoA, ["status", "--porcelain"]), statusBefore);
    assert.equal(statSync(join(repoA, ".git", "index")).mtimeMs, indexMtimeBefore);
});
