import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { collectGitKnownStates } from "./engineV3_replay_reverse.ts";

const COMMIT_INSTANT = new Date(Date.UTC(2026, 0, 1, 0, 0, 10));

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-git-states-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function runGit(folder: string, args: string[]): string {
    const commitDate = COMMIT_INSTANT.toISOString();
    return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, encoding: "utf8" }).trim();
}

// A git repo with one commit holding the file at relativeFilePath.
function makeRepoWithCommittedFile(t: TestContext, relativeFilePath: string, text: string): { repoFolder: string; commitHash: string } {
    const repoFolder = makeTempFolder(t);
    runGit(repoFolder, ["init", "-q"]);
    mkdirSync(join(repoFolder, relativeFilePath, ".."), { recursive: true });
    writeFileSync(join(repoFolder, relativeFilePath), text);
    runGit(repoFolder, ["add", relativeFilePath]);
    runGit(repoFolder, ["commit", "-q", "-m", "first"]);
    return { repoFolder, commitHash: runGit(repoFolder, ["rev-parse", "HEAD"]) };
}

test("test_collectGitKnownStates_returns_the_commit_text_for_a_file_inside_a_git_repo", (t) => {
    // Scenario: a small real repo has one commit of the file.
    const { repoFolder, commitHash } = makeRepoWithCommittedFile(t, "a.txt", "committed\n");
    // collect the git states of that file
    const states = collectGitKnownStates(new Path(join(repoFolder, "a.txt")));
    // one state holds the committed text, the committer date and the commit hash
    assert.equal(states.length, 1);
    assert.equal(states[0]!.content, "committed\n");
    assert.equal(states[0]!.timestamp.getTime(), COMMIT_INSTANT.getTime());
    assert.equal(states[0]!.commitHash!.toString(), commitHash);
});

test("test_collectGitKnownStates_returns_an_empty_list_for_a_file_in_a_folder_outside_any_git_repo", (t) => {
    // Scenario: the file sits in a plain temp folder that is inside no git work tree.
    const folder = makeTempFolder(t);
    writeFileSync(join(folder, "a.txt"), "text\n");
    // collect the git states of that file
    const states = collectGitKnownStates(new Path(join(folder, "a.txt")));
    // a project with no git has no git states
    assert.deepEqual(states, []);
});

test("test_collectGitKnownStates_returns_an_empty_list_for_a_folder_that_does_not_exist_outside_any_git_repo", (t) => {
    // Scenario: the file was deleted together with its folder, and no parent folder is inside a git work tree.
    const folder = makeTempFolder(t);
    // collect the git states of a file in a folder that is not on disk
    const states = collectGitKnownStates(new Path(join(folder, "gone", "a.txt")));
    // a project with no git has no git states
    assert.deepEqual(states, []);
});

test("test_collectGitKnownStates_finds_the_history_of_a_file_whose_folder_was_deleted_from_disk", (t) => {
    // Scenario: the repo committed sub/a.txt, then the folder sub was removed from disk.
    const { repoFolder, commitHash } = makeRepoWithCommittedFile(t, join("sub", "a.txt"), "committed\n");
    rmSync(join(repoFolder, "sub"), { recursive: true });
    // collect the git states of the file in the missing folder
    const states = collectGitKnownStates(new Path(join(repoFolder, "sub", "a.txt")));
    // the commit that held the file still gives a state
    assert.equal(states.length, 1);
    assert.equal(states[0]!.content, "committed\n");
    assert.equal(states[0]!.commitHash!.toString(), commitHash);
});

test("test_collectGitKnownStates_returns_an_empty_list_for_a_path_that_is_a_submodule_entry", (t) => {
    // Scenario: the repo committed a submodule entry at plate-test.
    const repoFolder = makeTempFolder(t);
    runGit(repoFolder, ["init", "-q"]);
    // add the submodule entry (mode 160000) to the index
    runGit(repoFolder, ["update-index", "--add", "--cacheinfo", "160000,04e3932a58d9200aff789aac8ebeacd698c79ac2,plate-test"]);
    // commit the submodule entry
    runGit(repoFolder, ["commit", "-q", "-m", "add the submodule entry"]);
    // collect the git states of the submodule path
    const states = collectGitKnownStates(new Path(join(repoFolder, "plate-test")));
    // a submodule entry holds no text, so it gives no git state
    assert.deepEqual(states, []);
});
