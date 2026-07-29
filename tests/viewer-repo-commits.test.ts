// Tests for the task-137 repo/commit-picker server surface (src/viewer_api_repo.ts): the git-log wire parser, the commit-tree membership counter, and the real-repo commit listing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    countPathsInTree,
    listRepoCommits,
    parseGitLogOutput,
} from "../src/viewer_api_repo.ts";
import { Path } from "../src/structures/domain.ts";

test("test_parseGitLogOutput_splits_hash_date_subject", () => {
    // Behavior: each git-log line is <hash>\t<date>\t<subject>; the subject may itself contain further tabs and must survive intact; a trailing blank line is ignored.  Steps: two well-formed lines, the second with a tab inside the subject, plus a trailing newline.
    const hashA = "a".repeat(40);
    const hashB = "b".repeat(40);
    const output = `${hashA}\t2026-07-21\tfirst subject\n${hashB}\t2026-07-20\tsecond\tsubject\n`;
    const rows = parseGitLogOutput(output);
    // both rows parse with exact fields, in input order.
    assert.deepEqual(rows, [
        { hash: hashA, date: "2026-07-21", subject: "first subject" },
        { hash: hashB, date: "2026-07-20", subject: "second\tsubject" },
    ]);
});

test("test_countPathsInTree_counts_membership", () => {
    // Behavior: the soft-warning math — how many of the project's recorded relative paths exist in the picked commit's tree.  Steps: three recorded paths, two of them present in the tree set.
    const counts = countPathsInTree(["a.py", "sub/b.py", "missing.py"], new Set(["a.py", "sub/b.py"]));
    assert.deepEqual(counts, { matchedCount: 2, totalCount: 3 });
    // an empty recorded set counts nothing.
    assert.deepEqual(countPathsInTree([], new Set(["a.py"])), { matchedCount: 0, totalCount: 0 });
});

test("test_listRepoCommits_reads_a_real_repo_newest_first", () => {
    // Behavior: listRepoCommits shells out to git log in the given repo and returns one row per commit, newest first, with full 40-hex hashes.  Steps: a throwaway repo with two commits (the reconstruction_base_commit.test.ts recipe).
    const repoDir = mkdtempSync(join(tmpdir(), "reveng-repo-commits-"));
    writeFileSync(join(repoDir, "a.txt"), "one\n");
    execSync("git init -q -b main", { cwd: repoDir });
    execSync("git config user.email t@t", { cwd: repoDir });
    execSync("git config user.name t", { cwd: repoDir });
    execSync("git add -A", { cwd: repoDir });
    execSync("git commit -q -m first", { cwd: repoDir });
    writeFileSync(join(repoDir, "b.txt"), "two\n");
    execSync("git add -A", { cwd: repoDir });
    execSync("git commit -q -m second", { cwd: repoDir });
    const rows = listRepoCommits(new Path(repoDir));
    // two commits, newest ("second") first.
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.subject, "second");
    assert.equal(rows[1]!.subject, "first");
    // hashes are full 40-hex; dates are the --date=short form.
    for (const row of rows) {
        assert.match(row.hash, /^[0-9a-f]{40}$/);
        assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    }
});
