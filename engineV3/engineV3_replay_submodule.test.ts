import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";

type SubmoduleRepos = { parentGitFolder: string; addCommit: string; moveCommit: string };

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

// Parent commit 1 adds submodule "sub" (a.txt, b.txt); parent commit 2 moves it (a.txt gone, c.txt added).
function makeSubmoduleRepos(t: TestContext): SubmoduleRepos {
    const subRepo = makeTempFolder(t, "engine-v3-sub-source-");
    runGitWithDate(subRepo, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(subRepo, "a.txt", "a");
    writeFileIn(subRepo, "b.txt", "b");
    commitAll(subRepo, "2026-01-01T00:00:10Z", "sub 1");
    const parent = makeTempFolder(t, "engine-v3-sub-parent-");
    runGitWithDate(parent, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(parent, "README.md", "readme");
    commitAll(parent, "2026-01-01T00:00:10Z", "parent 0");
    runGitWithDate(parent, "2026-01-01T00:00:20Z", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", subRepo, "sub"]);
    const addCommit = commitAll(parent, "2026-01-01T00:00:20Z", "parent adds sub");
    rmSync(join(parent, "sub", "a.txt"));
    writeFileIn(join(parent, "sub"), "c.txt", "c");
    commitAll(join(parent, "sub"), "2026-01-01T00:00:30Z", "sub 2");
    const moveCommit = commitAll(parent, "2026-01-01T00:00:30Z", "parent moves sub");
    return { parentGitFolder: join(parent, ".git"), addCommit, moveCommit };
}

test("test_applyCommitToState_writes_the_submodule_files_when_a_commit_adds_a_submodule", (t) => {
    // Scenario: a commit adds submodule sub, so the state folder gets sub/a.txt and sub/b.txt.
    const repos = makeSubmoduleRepos(t);
    const stateFolder = makeTempFolder(t, "engine-v3-sub-state-");
    // apply the commit that adds the submodule
    applyCommitToState(new Uuid(repos.addCommit), new Path(stateFolder), new Path(repos.parentGitFolder));
    // the submodule files are in the state folder
    assert.equal(readFileSync(join(stateFolder, "sub/a.txt"), "utf8"), "a");
    assert.equal(readFileSync(join(stateFolder, "sub/b.txt"), "utf8"), "b");
});

test("test_applyCommitToState_reads_a_submodule_from_a_copied_git_folder", (t) => {
    // Scenario: only .git is copied, so the submodule's core.worktree points at a missing folder.
    const repos = makeSubmoduleRepos(t);
    const stateFolder = makeTempFolder(t, "engine-v3-sub-state-");
    const copyFolder = makeTempFolder(t, "engine-v3-sub-copy-");
    const copiedGitFolder = join(copyFolder, "repo.git");
    cpSync(repos.parentGitFolder, copiedGitFolder, { recursive: true });
    // apply the add commit from the copy
    applyCommitToState(new Uuid(repos.addCommit), new Path(stateFolder), new Path(copiedGitFolder));
    // the submodule files are in the state folder
    assert.equal(readFileSync(join(stateFolder, "sub/a.txt"), "utf8"), "a");
});

test("test_applyCommitToState_updates_the_submodule_files_when_the_pointer_moves", (t) => {
    // Scenario: the pointer moves, so sub/a.txt is removed, sub/c.txt is added, sub/b.txt stays.
    const repos = makeSubmoduleRepos(t);
    const stateFolder = makeTempFolder(t, "engine-v3-sub-state-");
    // apply the add commit, then the move commit
    applyCommitToState(new Uuid(repos.addCommit), new Path(stateFolder), new Path(repos.parentGitFolder));
    applyCommitToState(new Uuid(repos.moveCommit), new Path(stateFolder), new Path(repos.parentGitFolder));
    // a.txt is gone, c.txt is new, b.txt is kept
    assert.equal(existsSync(join(stateFolder, "sub/a.txt")), false);
    assert.equal(readFileSync(join(stateFolder, "sub/c.txt"), "utf8"), "c");
    assert.equal(readFileSync(join(stateFolder, "sub/b.txt"), "utf8"), "b");
});
