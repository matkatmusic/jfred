// Task 233 (spec S18): listPairCommitHistory — one node per commit that TOUCHED a pair's path,
// none for the commits that did not. Fixture is a real temp repo of four commits where the target
// is touched by exactly two of them, with committer and author times deliberately set to
// DIFFERENT days so a run that read author time would be caught by the instant assertions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPairCommitHistory } from "../src/layer1_commit_history.ts";
import { Path } from "../src/structures/domain.ts";

// Run a git command in `repoDir` with a fixed identity; the two dates are pinned apart so the
// module's time source is observable — committer 2026-07-0X, author always 2020-01-01.
function runGit(repoDir: string, command: string, committerDate?: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
        cwd: repoDir,
        stdio: "pipe",
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
            ...(committerDate === undefined ? {} : { GIT_COMMITTER_DATE: committerDate }),
        },
    }).toString();
}

// Commit `relativePath` holding `content` at `committerDate`.
function commitFile(repoDir: string, relativePath: string, content: string, committerDate: string): void {
    writeFileSync(join(repoDir, relativePath), content);
    runGit(repoDir, `add ${JSON.stringify(relativePath)}`);
    runGit(repoDir, `commit -q -m ${JSON.stringify(relativePath + committerDate)}`, committerDate);
}

// Four commits; nested/target.txt is created by the first and edited by the third. Commits two
// and four touch other.txt only, so they must contribute nothing to the target's history.
function makeFourCommitRepo(): { repoDir: string; targetHashes: string[] } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-commit-history-"));
    runGit(repoDir, "init -q");
    mkdirSync(join(repoDir, "nested"));
    commitFile(repoDir, "nested/target.txt", "one\n", "2026-07-01T10:00:00Z");
    const firstTargetHash = runGit(repoDir, "rev-parse HEAD").trim();
    commitFile(repoDir, "other.txt", "unrelated\n", "2026-07-02T11:00:00Z");
    commitFile(repoDir, "nested/target.txt", "two\n", "2026-07-03T12:00:00Z");
    const secondTargetHash = runGit(repoDir, "rev-parse HEAD").trim();
    commitFile(repoDir, "other.txt", "unrelated again\n", "2026-07-04T13:00:00Z");
    return { repoDir, targetHashes: [firstTargetHash, secondTargetHash] };
}

test("test_only_the_commits_that_touched_the_file_become_nodes", () => {
    // Scenario: of four commits, two touched nested/target.txt — so the history has exactly two
    // entries, in commit order (oldest first), and the untouching commits leave no empty node.
    const { repoDir, targetHashes } = makeFourCommitRepo();
    const history = listPairCommitHistory(new Path(repoDir), new Path("nested/target.txt"));
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((node) => node.hash), targetHashes);
});

test("test_history_instants_come_from_committer_time_never_author_time", () => {
    // Scenario: every commit in the fixture was authored 2020-01-01 and committed on its own
    // 2026-07 day. The nodes must carry the 2026 committer instants — an author-time read would
    // collapse both onto 2020-01-01 (S18 / hpp Q7: one machine, one clock).
    const { repoDir } = makeFourCommitRepo();
    const history = listPairCommitHistory(new Path(repoDir), new Path("nested/target.txt"));
    assert.deepEqual(history.map((node) => node.instant), [
        new Date("2026-07-01T10:00:00.000Z"),
        new Date("2026-07-03T12:00:00.000Z"),
    ]);
});

test("test_a_path_no_commit_ever_touched_has_an_empty_history", () => {
    // Scenario: a repo-tracked-looking path that no commit touched contributes no nodes at all
    // rather than a placeholder — the same posture the untouching commits get above.
    const { repoDir } = makeFourCommitRepo();
    assert.deepEqual(listPairCommitHistory(new Path(repoDir), new Path("never-committed.txt")), []);
});

test("test_a_renamed_file_shows_only_its_post_rename_history", () => {
    // Scenario: S18 forbids `--follow` because rename tracking belongs to S6. After renaming
    // nested/target.txt to nested/renamed.txt, the new path shows ONLY the rename commit — the
    // two pre-rename commits stay with the old path. This is the documented shorter history.
    const { repoDir } = makeFourCommitRepo();
    runGit(repoDir, "mv nested/target.txt nested/renamed.txt");
    runGit(repoDir, "commit -q -m rename", "2026-07-05T14:00:00Z");
    const history = listPairCommitHistory(new Path(repoDir), new Path("nested/renamed.txt"));
    assert.deepEqual(history.map((node) => node.instant), [new Date("2026-07-05T14:00:00.000Z")]);
});
