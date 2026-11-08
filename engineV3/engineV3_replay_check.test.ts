import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { compareStateToHead } from "./engineV3_replay_check.ts";

function runGitWithDate(folder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8", env }).trim();
}

function commitAll(folder: string, isoDate: string, message: string): string {
    runGitWithDate(folder, isoDate, ["add", "-A"]);
    runGitWithDate(folder, isoDate, ["commit", "-q", "-m", message]);
    return runGitWithDate(folder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeFileIn(folder: string, name: string, content: string): void {
    const filePath = join(folder, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}

// HEAD holds a.txt ("a") and b.txt ("b").
function makeRepoWithTwoFiles(t: TestContext): { repoFolder: string; headCommit: string } {
    const repoFolder = makeTempFolder(t, "engine-v3-check-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(repoFolder, "a.txt", "a");
    writeFileIn(repoFolder, "b.txt", "b");
    const headCommit = commitAll(repoFolder, "2026-01-01T00:00:10Z", "two files");
    return { repoFolder, headCommit };
}

test("test_compareStateToHead_lists_a_missing_file", (t) => {
    // Scenario: the state folder lacks b.txt, so b.txt is listed as missing.
    const { repoFolder, headCommit } = makeRepoWithTwoFiles(t);
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "a.txt", "a");
    // compare the state folder to HEAD
    const lines = compareStateToHead(new Path(stateFolder), new Path(repoFolder));
    // one missing file and the summary line
    assert.deepEqual(lines, ["missing from state: b.txt", `check vs HEAD ${headCommit}: 1 missing, 0 extra, 0 different`]);
});

test("test_compareStateToHead_lists_an_extra_file", (t) => {
    // Scenario: the state folder has extra.txt that HEAD lacks, so extra.txt is listed as extra.
    const { repoFolder, headCommit } = makeRepoWithTwoFiles(t);
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "a.txt", "a");
    writeFileIn(stateFolder, "b.txt", "b");
    writeFileIn(stateFolder, "dir/extra.txt", "x");
    // compare the state folder to HEAD
    const lines = compareStateToHead(new Path(stateFolder), new Path(repoFolder));
    // one extra file and the summary line
    assert.deepEqual(lines, ["extra in state: dir/extra.txt", `check vs HEAD ${headCommit}: 0 missing, 1 extra, 0 different`]);
});

test("test_compareStateToHead_skips_the_git_folder_at_the_state_root", (t) => {
    // Scenario: the state folder has .git/config that HEAD lacks, so .git/config is not listed as extra.
    const { repoFolder, headCommit } = makeRepoWithTwoFiles(t);
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "a.txt", "a");
    writeFileIn(stateFolder, "b.txt", "b");
    writeFileIn(stateFolder, ".git/config", "x");
    // compare the state folder to HEAD
    const lines = compareStateToHead(new Path(stateFolder), new Path(repoFolder));
    // only the summary line
    assert.deepEqual(lines, [`check vs HEAD ${headCommit}: 0 missing, 0 extra, 0 different`]);
});

test("test_compareStateToHead_skips_the_idleState_folder_at_the_state_root", (t) => {
    // Scenario: the state folder has .idleState/x.json that HEAD lacks, so x.json is not listed as extra.
    const { repoFolder, headCommit } = makeRepoWithTwoFiles(t);
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "a.txt", "a");
    writeFileIn(stateFolder, "b.txt", "b");
    writeFileIn(stateFolder, ".idleState/x.json", "x");
    // compare the state folder to HEAD
    const lines = compareStateToHead(new Path(stateFolder), new Path(repoFolder));
    // only the summary line
    assert.deepEqual(lines, [`check vs HEAD ${headCommit}: 0 missing, 0 extra, 0 different`]);
});

test("test_compareStateToHead_lists_a_file_with_different_content", (t) => {
    // Scenario: a.txt has other bytes in the state folder, so a.txt is listed as different.
    const { repoFolder, headCommit } = makeRepoWithTwoFiles(t);
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "a.txt", "changed");
    writeFileIn(stateFolder, "b.txt", "b");
    // compare the state folder to HEAD
    const lines = compareStateToHead(new Path(stateFolder), new Path(repoFolder));
    // one different file and the summary line
    assert.deepEqual(lines, ["different content: a.txt", `check vs HEAD ${headCommit}: 0 missing, 0 extra, 1 different`]);
});

test("test_compareStateToHead_includes_submodule_files_at_the_pointed_commit", (t) => {
    // Scenario: HEAD points sub at a commit with b.txt and c.txt; the copied .git has the sub files.
    const subRepo = makeTempFolder(t, "engine-v3-check-sub-source-");
    runGitWithDate(subRepo, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(subRepo, "b.txt", "b");
    commitAll(subRepo, "2026-01-01T00:00:10Z", "sub 1");
    const parent = makeTempFolder(t, "engine-v3-check-parent-");
    runGitWithDate(parent, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(parent, "README.md", "readme");
    commitAll(parent, "2026-01-01T00:00:10Z", "parent 0");
    runGitWithDate(parent, "2026-01-01T00:00:20Z", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", subRepo, "sub"]);
    writeFileIn(join(parent, "sub"), "c.txt", "c");
    commitAll(join(parent, "sub"), "2026-01-01T00:00:30Z", "sub 2");
    const headCommit = commitAll(parent, "2026-01-01T00:00:30Z", "parent adds sub at sub 2");
    const copyFolder = makeTempFolder(t, "engine-v3-check-copy-");
    cpSync(join(parent, ".git"), join(copyFolder, "repo.git"), { recursive: true });
    // the state folder has everything except sub/b.txt, and sub/c.txt has other bytes
    const stateFolder = makeTempFolder(t, "engine-v3-check-state-");
    writeFileIn(stateFolder, "README.md", "readme");
    writeFileIn(stateFolder, ".gitmodules", "ignored");
    writeFileIn(stateFolder, "sub/c.txt", "wrong");
    // compare the state folder to HEAD, read from the copy
    const lines = compareStateToHead(new Path(stateFolder), new Path(join(copyFolder, "repo.git")));
    // sub/b.txt is missing, sub/c.txt differs, and .gitmodules differs
    assert.deepEqual(lines, ["missing from state: sub/b.txt", "different content: .gitmodules", "different content: sub/c.txt", `check vs HEAD ${headCommit}: 1 missing, 0 extra, 2 different`]);
});
