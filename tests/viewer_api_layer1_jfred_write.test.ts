// Task 361 phase 3d: writeJfredMarkCommit and removeJfredBranch on a temp repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeJfredBranch, writeJfredMarkCommit } from "../src/viewer_api_layer1_jfred_write.ts";
import { Path } from "../src/structures/domain.ts";
import type { WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";

type TempRepo = ReturnType<typeof createJfredTempRepo>;

const MARK_INSTANT = "2026-07-02T09:00:00Z";
const COMMITTED_AT = new Date("2026-07-02T12:00:00Z");
const MESSAGE = `jfred: reconstruct to ${MARK_INSTANT}\n\nincludes 2 unmarked changes\n\nreconstructed by JFRED @ 2026-07-02T12:00:00Z`;

function runGit(repoDir: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

function commitMark(repo: TempRepo, parentShortHash: string | undefined, texts: Record<string, string>, newlinePaths: string[] = []) {
    const request: WireJfredCommitRequest = { baseShortHash: repo.commitHashes[1]!.slice(0, 8), markInstant: MARK_INSTANT, message: MESSAGE, allowScripts: false };
    if (parentShortHash !== undefined)
        request.parentShortHash = parentShortHash;
    return writeJfredMarkCommit(new Path(repo.repoDir), request, COMMITTED_AT, new Map(Object.entries(texts)), () => new Set(newlinePaths));
}

function readJfredTip(repo: TempRepo): string {
    return runGit(repo.repoDir, ["rev-parse", "jfred"]).trim();
}

test("test_writeJfredMarkCommit_first_commit_creates_the_branch_with_the_base_as_parent", () => {
    // Setup: a temp repo with no jfred branch.
    const repo = createJfredTempRepo();
    // Action: make the first commit.
    commitMark(repo, undefined, { "a.txt": "edited" });
    // Verify: the branch exists and its parent is C2's full hash.
    assert.equal(runGit(repo.repoDir, ["rev-parse", "jfred^"]).trim(), repo.commitHashes[1]);
});

test("test_writeJfredMarkCommit_never_moves_head_the_working_tree_or_the_index", () => {
    // Setup: record HEAD, status and index before.
    const repo = createJfredTempRepo();
    const readState = () => [["rev-parse", "HEAD"], ["status", "--porcelain"], ["ls-files", "-s"]].map((args) => runGit(repo.repoDir, args)).join("|");
    const before = readState();
    // Action: make a commit.
    commitMark(repo, undefined, { "a.txt": "edited" });
    // Verify: all three are unchanged.
    assert.equal(readState(), before);
});

test("test_writeJfredMarkCommit_second_commit_has_the_first_commit_as_parent_not_the_base", () => {
    // Setup: a first commit.
    const repo = createJfredTempRepo();
    const first = commitMark(repo, undefined, { "a.txt": "one" })!;
    const firstHash = readJfredTip(repo);
    // Action: make a second commit naming the first as parent.
    commitMark(repo, first.shortHash, { "a.txt": "two" });
    // Verify: the parent is the first commit, not C2.
    assert.equal(runGit(repo.repoDir, ["rev-parse", "jfred^"]).trim(), firstHash);
});

test("test_writeJfredMarkCommit_author_date_is_the_mark_instant_and_committer_date_is_committedAt", () => {
    // Setup and action: one commit.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "edited" });
    // Verify: both dates match to the second.
    const [authorDate, committerDate] = runGit(repo.repoDir, ["log", "-1", "--format=%aI%n%cI", "jfred"]).trim().split("\n");
    assert.equal(Date.parse(authorDate!), Date.parse(MARK_INSTANT));
    assert.equal(Date.parse(committerDate!), COMMITTED_AT.getTime());
});

test("test_writeJfredMarkCommit_stores_the_message_verbatim_including_includes_line_and_footnote", () => {
    // Setup and action: one commit with a three-part message.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "edited" });
    // Verify: the stored message equals the request message.
    assert.equal(runGit(repo.repoDir, ["log", "-1", "--format=%B", "jfred"]).trimEnd(), MESSAGE);
});

test("test_writeJfredMarkCommit_tree_holds_the_engine_text_and_keeps_every_other_file_of_the_parent", () => {
    // Setup and action: the engine lists only a.txt.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "new text" }, ["a.txt"]);
    // Verify: a.txt holds the engine text plus the final newline.
    assert.equal(runGit(repo.repoDir, ["show", "jfred:a.txt"]), "new text\n");
    // Verify: unlisted paths equal the parent's.
    for (const unlistedPath of ["sub/b.txt", "run.sh"])
        assert.equal(runGit(repo.repoDir, ["show", `jfred:${unlistedPath}`]), runGit(repo.repoDir, ["show", `${repo.commitHashes[1]}:${unlistedPath}`]));
});

test("test_writeJfredMarkCommit_diff_applies_cleanly_to_the_parent_tree", () => {
    // Setup: one commit editing a.txt; take the diff from the parent in the temp repo.
    const repo = createJfredTempRepo();
    commitMark(repo, undefined, { "a.txt": "edited" });
    const parentHash = repo.commitHashes[1]!;
    const diff = runGit(repo.repoDir, ["diff", parentHash, readJfredTip(repo)]);
    // Setup: clone into another temp dir and check out the parent there.
    const cloneParentDir = mkdtempSync(join(tmpdir(), "jfred-clone-"));
    runGit(cloneParentDir, ["clone", "-q", repo.repoDir, "clone"]);
    const cloneDir = join(cloneParentDir, "clone");
    runGit(cloneDir, ["checkout", "-q", parentHash]);
    // Verify: git apply --check accepts the diff.
    const applied = spawnSync("git", ["apply", "--check"], { cwd: cloneDir, input: diff, encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
});

test("test_writeJfredMarkCommit_returns_the_new_commit_as_the_last_listed_commit", () => {
    // Setup: a first commit, then a second.
    const repo = createJfredTempRepo();
    const first = commitMark(repo, undefined, { "a.txt": "one" })!;
    const second = commitMark(repo, first.shortHash, { "a.txt": "two" })!;
    // Verify: the result is the branch tip, parented on the first.
    assert.equal(second.shortHash, readJfredTip(repo).slice(0, 8));
    assert.equal(second.parentShortHash, first.shortHash);
    assert.equal(second.instant.getTime(), Date.parse(MARK_INSTANT));
});

test("test_removeJfredBranch_removes_only_the_jfred_ref", () => {
    // Setup: another branch, a jfred commit, and the state without jfred.
    const repo = createJfredTempRepo();
    runGit(repo.repoDir, ["branch", "other", repo.commitHashes[0]!]);
    commitMark(repo, undefined, { "a.txt": "edited" });
    const commitHash = readJfredTip(repo);
    const readOtherState = () => [runGit(repo.repoDir, ["rev-parse", "HEAD"]), runGit(repo.repoDir, ["status", "--porcelain"]), runGit(repo.repoDir, ["for-each-ref"]).split("\n").filter((line) => !line.endsWith("refs/heads/jfred")).join("\n")].join("|");
    const before = readOtherState();
    // Action: remove the branch.
    removeJfredBranch(new Path(repo.repoDir));
    // Verify: the jfred ref is gone, everything else is equal, the commit object stays.
    assert.equal(runGit(repo.repoDir, ["for-each-ref", "refs/heads/jfred"]), "");
    assert.equal(readOtherState(), before);
    assert.equal(runGit(repo.repoDir, ["cat-file", "-t", commitHash]).trim(), "commit");
});

test("test_removeJfredBranch_throws_when_the_branch_is_absent", () => {
    // Setup: a temp repo with no jfred branch.
    const repo = createJfredTempRepo();
    // Verify: removal throws.
    assert.throws(() => removeJfredBranch(new Path(repo.repoDir)), /git branch failed/);
});
