// Task 361 phase 3d: writeJfredMarkCommit refusals, no-change writes, newline and mode rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJfredMarkCommit } from "../src/viewer_api_layer1_jfred_write.ts";
import { Path } from "../src/structures/domain.ts";
import type { WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { createJfredTempRepo, runWithHostileGitEnvironment, snapshotRepoState } from "./jfred-write-test-helpers.ts";

type TempRepo = ReturnType<typeof createJfredTempRepo>;

const MARK_INSTANT = "2026-07-02T09:00:00Z";
const COMMITTED_AT = new Date("2026-07-02T12:00:00Z");
const MESSAGE = `jfred: reconstruct to ${MARK_INSTANT}\n\nreconstructed by JFRED @ 2026-07-02T12:00:00Z`;
const PARENT_FILE_PATHS = ["a.txt", "sub/b.txt", "run.sh"];

function runGit(repoDir: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

function commitMark(repo: TempRepo, parentShortHash: string | undefined, texts: Record<string, string>, newlinePaths: string[] = []) {
    const request: WireJfredCommitRequest = { baseShortHash: repo.commitHashes[1]!.slice(0, 8), markInstant: MARK_INSTANT, message: MESSAGE, allowScripts: false };
    if (parentShortHash !== undefined)
        request.parentShortHash = parentShortHash;
    return writeJfredMarkCommit(new Path(repo.repoDir), request, COMMITTED_AT, new Map(Object.entries(texts)), () => new Set(newlinePaths));
}

function readParentTextsWithoutFinalNewline(repo: TempRepo): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const filePath of PARENT_FILE_PATHS)
        texts[filePath] = runGit(repo.repoDir, ["show", `${repo.commitHashes[1]}:${filePath}`]).slice(0, -1);
    return texts;
}

test("test_writeJfredMarkCommit_refuses_a_stale_parent_short_hash", () => {
    // Setup: a first commit moves the branch tip.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "one" });
    const tipBefore = runGit(repo.repoDir, ["rev-parse", "jfred"]);
    // Verify: naming C2 as parent is refused and the tip stays.
    assert.throws(() => commitMark(repo, repo.commitHashes[1]!.slice(0, 8), { "a.txt": "two" }), /stale/);
    assert.equal(runGit(repo.repoDir, ["rev-parse", "jfred"]), tipBefore);
});

test("test_writeJfredMarkCommit_refuses_a_missing_parent_when_the_branch_exists_and_a_given_parent_when_it_does_not", () => {
    // Verify: with no branch, a given parent is refused and no branch appears.
    const repo = createJfredTempRepo();
    assert.throws(() => commitMark(repo, "deadbeef", { "a.txt": "one" }), /does not exist/);
    assert.equal(runGit(repo.repoDir, ["for-each-ref", "refs/heads/jfred"]), "");
    // Verify: with a branch, a missing parent is refused.
    commitMark(repo, undefined, { "a.txt": "one" });
    assert.throws(() => commitMark(repo, undefined, { "a.txt": "two" }), /needs a parent/);
});

test("test_writeJfredMarkCommit_changes_nothing_outside_the_temp_repo", () => {
    // Setup: a decoy repo that the hostile git variables point at.
    const repo = createJfredTempRepo();
    const decoy = createJfredTempRepo();
    const decoySnapshotBefore = snapshotRepoState(decoy.repoDir);
    // Action: commit while GIT_DIR and friends name the decoy.
    runWithHostileGitEnvironment(decoy.repoDir, () => {
        commitMark(repo, undefined, { "a.txt": "edited" });
    });
    // Verify: the decoy is byte-equal and the commit landed in the temp repo.
    assert.equal(snapshotRepoState(decoy.repoDir), decoySnapshotBefore);
    assert.equal(runGit(repo.repoDir, ["rev-parse", "jfred^"]).trim(), repo.commitHashes[1]);
});

test("test_writeJfredMarkCommit_returns_undefined_and_writes_nothing_when_no_file_differs_from_the_parent", () => {
    // Setup: engine texts equal the parent files without the final newline; the stub names every path.
    const repo = createJfredTempRepo();
    const snapshotBefore = snapshotRepoState(repo.repoDir);
    // Action: commit.
    const result = commitMark(repo, undefined, readParentTextsWithoutFinalNewline(repo), PARENT_FILE_PATHS);
    // Verify: nothing was returned and every byte under .git is equal.
    assert.equal(result, undefined);
    assert.equal(snapshotRepoState(repo.repoDir), snapshotBefore);
});

test("test_writeJfredMarkCommit_treats_a_final_newline_only_difference_as_a_change", () => {
    // Setup: engine texts equal the parent files without the final newline; the stub names no path.
    const repo = createJfredTempRepo();
    // Action: commit.
    const result = commitMark(repo, undefined, readParentTextsWithoutFinalNewline(repo));
    // Verify: a commit exists and a.txt lacks the parent's final newline.
    assert.notEqual(result, undefined);
    assert.equal(runGit(repo.repoDir, ["show", "jfred:a.txt"]), readParentTextsWithoutFinalNewline(repo)["a.txt"]);
});

test("test_writeJfredMarkCommit_adds_the_final_newline_for_a_path_the_stub_names_and_not_for_the_others", () => {
    // Action: the stub names a.txt only.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "alpha", "sub/b.txt": "beta" }, ["a.txt"]);
    // Verify: only a.txt ends with a newline.
    assert.equal(runGit(repo.repoDir, ["show", "jfred:a.txt"]), "alpha\n");
    assert.equal(runGit(repo.repoDir, ["show", "jfred:sub/b.txt"]), "beta");
});

test("test_writeJfredMarkCommit_adds_a_new_path_as_mode_100644", () => {
    // Action: the engine lists a path the parent lacks.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "new.txt": "fresh" });
    // Verify: the mode is 100644.
    assert.match(runGit(repo.repoDir, ["ls-tree", "jfred", "new.txt"]), /^100644 blob /);
});

test("test_writeJfredMarkCommit_keeps_the_executable_bit_of_an_existing_path", () => {
    // Action: the engine edits run.sh, which is mode 755 in the parent.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "run.sh": "echo edited" });
    // Verify: the mode stays 100755.
    assert.match(runGit(repo.repoDir, ["ls-tree", "jfred", "run.sh"]), /^100755 blob /);
});

test("test_writeJfredMarkCommit_leaves_no_jfred_index_folder_in_tmpdir", () => {
    // Setup: an empty scratch root becomes the temp folder for this test.
    const repo = createJfredTempRepo();
    const scratchRoot = mkdtempSync(join(tmpdir(), "jfred-scratch-root-"));
    const previousTmpdir = process.env["TMPDIR"];
    process.env["TMPDIR"] = scratchRoot;
    try {
        // Verify: a commit leaves the root empty.
        commitMark(repo, undefined, { "a.txt": "edited" });
        assert.deepEqual(readdirSync(scratchRoot), []);
        // Verify: a refused commit leaves the root empty.
        assert.throws(() => commitMark(repo, "deadbeef", { "a.txt": "again" }), /stale/);
        assert.deepEqual(readdirSync(scratchRoot), []);
    } finally {
        if (previousTmpdir === undefined)
            delete process.env["TMPDIR"];
        else
            process.env["TMPDIR"] = previousTmpdir;
    }
});
