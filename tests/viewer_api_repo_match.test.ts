// Tests for src/viewer_api_repo_match.ts: the commit tree path match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeCommitPathMatch } from "../src/viewer_api_repo_match.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_computeCommitPathMatch_counts_nothing_without_records", () => {
    // Behavior: no records means no recorded root, so zero paths match.  Steps: a one-commit repo and an empty record list.
    const repoDir = mkdtempSync(join(tmpdir(), "reveng-repo-match-"));
    writeFileSync(join(repoDir, "a.txt"), "one\n");
    execSync("git init -q -b main", { cwd: repoDir });
    execSync("git config user.email t@t", { cwd: repoDir });
    execSync("git config user.name t", { cwd: repoDir });
    execSync("git add -A", { cwd: repoDir });
    execSync("git commit -q -m first", { cwd: repoDir });
    const head = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
    // both counts are zero.
    assert.deepEqual(computeCommitPathMatch([], new Path(repoDir), new Uuid(head)), { matchedCount: 0, totalCount: 0 });
});
