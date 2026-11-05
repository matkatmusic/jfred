import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
    cloneProjectAtCommit,
    findCommitBeforeRun,
    findRepoRoot,
    isGitRepository,
} from "../src/reconstruction_script_sandbox_project.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function runTestGit(cwd: string, args: string[], date?: string): string {
    const env = date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
    const configured = ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args];
    return execFileSync("git", configured, { cwd, env, encoding: "utf8" }).trim();
}

function commitFile(repo: string, name: string, date: string): string {
    writeFileSync(join(repo, name), `${name} ${date}\n`);
    runTestGit(repo, ["add", name]);
    runTestGit(repo, ["commit", "-q", "-m", name], date);
    return runTestGit(repo, ["rev-parse", "HEAD"]);
}

const DAY_1 = "2026-01-01T00:00:00Z";
const DAY_2 = "2026-01-02T00:00:00Z";
const DAY_3 = "2026-01-03T00:00:00Z";
const DAY_4 = "2026-01-04T00:00:00Z";
const WHEN = new Date("2026-01-05T00:00:00Z");

interface TestRepo {
    root: string;
    mainFirst: string;
    mainTip: string;
    featTip: string;
    originOnly: string;
}

// main: day1, day3. feat (from day1): day2. origin/x: day4, held by no local branch or tag.
function createTestRepo(): TestRepo {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reveng-project-test-")));
    runTestGit(root, ["init", "-q", "-b", "main"]);
    const mainFirst = commitFile(root, "a.txt", DAY_1);
    runTestGit(root, ["checkout", "-q", "-b", "feat"]);
    const featTip = commitFile(root, "f.txt", DAY_2);
    runTestGit(root, ["checkout", "-q", "main"]);
    const mainTip = commitFile(root, "b.txt", DAY_3);
    runTestGit(root, ["checkout", "-q", "-b", "scratch"]);
    const originOnly = commitFile(root, "o.txt", DAY_4);
    runTestGit(root, ["update-ref", "refs/remotes/origin/x", originOnly]);
    runTestGit(root, ["checkout", "-q", "main"]);
    runTestGit(root, ["branch", "-q", "-D", "scratch"]);
    return { root, mainFirst, mainTip, featTip, originOnly };
}

function withTestRepo(body: (repo: TestRepo) => void): void {
    const repo = createTestRepo();
    try {
        body(repo);
    } finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
}

function hashTree(dir: string): Map<string, string> {
    const hashes = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile()) {
            continue;
        }
        const file = join(entry.parentPath, entry.name);
        hashes.set(file, createHash("sha1").update(readFileSync(file)).digest("hex"));
    }
    return hashes;
}

test("test_findCommitBeforeRun_found_local_branch_returns_that_branchs_newest_commit", () => {
    withTestRepo((repo) => {
        const found = findCommitBeforeRun(new Path(repo.root), WHEN, "feat");
        assert.equal(found?.toString(), repo.featTip);
    });
});

test("test_findCommitBeforeRun_found_origin_branch_returns_the_origin_only_commit", () => {
    withTestRepo((repo) => {
        const found = findCommitBeforeRun(new Path(repo.root), WHEN, "x");
        assert.equal(found?.toString(), repo.originOnly);
    });
});

test("test_findCommitBeforeRun_missing_branch_name_uses_the_time_rule", () => {
    withTestRepo((repo) => {
        const found = findCommitBeforeRun(new Path(repo.root), WHEN, "parallel-debate-agent-launch");
        assert.equal(found?.toString(), repo.mainTip);
    });
});

test("test_findCommitBeforeRun_HEAD_and_undefined_use_the_time_rule", () => {
    withTestRepo((repo) => {
        assert.equal(findCommitBeforeRun(new Path(repo.root), WHEN, "HEAD")?.toString(), repo.mainTip);
        assert.equal(findCommitBeforeRun(new Path(repo.root), WHEN, undefined)?.toString(), repo.mainTip);
    });
});

test("test_findCommitBeforeRun_before_the_first_commit_is_undefined", () => {
    withTestRepo((repo) => {
        const beforeAll = new Date("2025-12-31T00:00:00Z");
        assert.equal(findCommitBeforeRun(new Path(repo.root), beforeAll, "main"), undefined);
        assert.equal(findCommitBeforeRun(new Path(repo.root), beforeAll, undefined), undefined);
    });
});

test("test_isGitRepository_is_false_for_a_folder_without_dot_git", () => {
    withTestRepo((repo) => {
        assert.equal(isGitRepository(new Path(repo.root)), true);
        const plain = mkdtempSync(join(tmpdir(), "reveng-project-plain-"));
        try {
            assert.equal(isGitRepository(new Path(plain)), false);
        } finally {
            rmSync(plain, { recursive: true, force: true });
        }
    });
});

test("test_findRepoRoot_returns_the_top_folder_from_a_subfolder", () => {
    withTestRepo((repo) => {
        const sub = join(repo.root, "deep");
        mkdirSync(sub);
        assert.equal(findRepoRoot(new Path(sub)).toString(), repo.root);
    });
});

test("test_cloneProjectAtCommit_makes_a_detached_isolated_copy_and_leaves_the_source_alone", () => {
    withTestRepo((repo) => {
        runTestGit(repo.root, ["gc", "-q"]);
        const sourceBefore = hashTree(join(repo.root, ".git"));
        const destination = mkdtempSync(join(tmpdir(), "reveng-project-clone-"));
        try {
            cloneProjectAtCommit(new Path(repo.root), new Uuid(repo.mainFirst), new Path(destination));
            assert.equal(runTestGit(destination, ["rev-parse", "HEAD"]), repo.mainFirst);
            assert.equal(runTestGit(destination, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
            assert.equal(existsSync(join(destination, "a.txt")), true);
            assert.equal(existsSync(join(destination, "b.txt")), false);
            assert.equal(existsSync(join(destination, ".git", "hooks")), false);
            assert.equal(existsSync(join(destination, ".git", "objects", "info", "alternates")), false);
            const packName = readdirSync(join(repo.root, ".git", "objects", "pack")).find((name) => name.endsWith(".pack"));
            assert.ok(packName !== undefined);
            const sourcePack = statSync(join(repo.root, ".git", "objects", "pack", packName));
            const clonePack = statSync(join(destination, ".git", "objects", "pack", packName));
            assert.notEqual(clonePack.ino, sourcePack.ino);
            assert.deepEqual(hashTree(join(repo.root, ".git")), sourceBefore);
        } finally {
            rmSync(destination, { recursive: true, force: true });
        }
    });
});

test("test_cloneProjectAtCommit_checks_out_a_commit_only_an_origin_ref_holds", () => {
    withTestRepo((repo) => {
        const commit = findCommitBeforeRun(new Path(repo.root), WHEN, "x");
        assert.ok(commit !== undefined);
        const destination = mkdtempSync(join(tmpdir(), "reveng-project-clone-"));
        try {
            cloneProjectAtCommit(new Path(repo.root), commit, new Path(destination));
            assert.equal(runTestGit(destination, ["rev-parse", "HEAD"]), repo.originOnly);
        } finally {
            rmSync(destination, { recursive: true, force: true });
        }
    });
});
