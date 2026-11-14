import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { fillOutsideGitFoldersAtTime } from "./engineV3_replay_outside_folders.ts";

const FIRST_COMMIT_TIME = "2026-01-01T10:00:00Z";
const SECOND_COMMIT_TIME = "2026-02-01T10:00:00Z";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-outside-folders-"));
    t.after(() => {
        execFileSync("chmod", ["-R", "u+w", folder]);
        rmSync(folder, { recursive: true, force: true });
    });
    return folder;
}

function runGitAtTime(repo: string, time: string, args: string[]): void {
    execFileSync("git", ["-c", "protocol.file.allow=always", "-C", repo, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: time, GIT_COMMITTER_DATE: time, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

// A repo with notes.txt "one" at the first time and "two" at the second, plus an ignored node_modules folder.
function makeLiveRepoWithTwoCommits(liveFolder: string): void {
    mkdirSync(liveFolder, { recursive: true });
    runGitAtTime(liveFolder, FIRST_COMMIT_TIME, ["init", "-q", "-b", "master"]);
    writeFileSync(join(liveFolder, ".gitignore"), "node_modules/\n");
    writeFileSync(join(liveFolder, "notes.txt"), "one\n");
    runGitAtTime(liveFolder, FIRST_COMMIT_TIME, ["add", "."]);
    runGitAtTime(liveFolder, FIRST_COMMIT_TIME, ["commit", "-q", "-m", "first"]);
    writeFileSync(join(liveFolder, "notes.txt"), "two\n");
    runGitAtTime(liveFolder, SECOND_COMMIT_TIME, ["commit", "-q", "-am", "second"]);
    mkdirSync(join(liveFolder, "node_modules"));
    writeFileSync(join(liveFolder, "node_modules", "package.txt"), "today\n");
}

test("test_fill_writes_the_tracked_files_of_the_commit_checked_out_at_the_event_time", (t) => {
    // Scenario: the live repo is today's; the event happened between the two commits, so notes.txt must be the first commit's text.
    const root = makeTempFolder(t);
    const liveRoot = join(root, "live");
    const macFolder = join(root, "mac", "repo");
    makeLiveRepoWithTwoCommits(liveRoot + macFolder);
    mkdirSync(macFolder, { recursive: true });
    // the live .git is read-only, as the docker mount is
    execFileSync("chmod", ["-R", "a-w", join(liveRoot + macFolder, ".git")]);
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2026-01-15T00:00:00Z"));
    assert.equal(readFileSync(join(macFolder, "notes.txt"), "utf8"), "one\n");
});

test("test_fill_moves_the_tracked_files_to_a_later_commit", (t) => {
    // Scenario: a later event is after the second commit, so the same folder is refilled with the second commit's text.
    const root = makeTempFolder(t);
    const liveRoot = join(root, "live");
    const macFolder = join(root, "mac", "repo");
    makeLiveRepoWithTwoCommits(liveRoot + macFolder);
    mkdirSync(macFolder, { recursive: true });
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2026-01-15T00:00:00Z"));
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2026-03-01T00:00:00Z"));
    assert.equal(readFileSync(join(macFolder, "notes.txt"), "utf8"), "two\n");
});

test("test_fill_links_ignored_files_to_today's_live_folder", (t) => {
    // Scenario: node_modules is ignored by git, so it comes from today's folder as a link, not a copy.
    const root = makeTempFolder(t);
    const liveRoot = join(root, "live");
    const macFolder = join(root, "mac", "repo");
    makeLiveRepoWithTwoCommits(liveRoot + macFolder);
    mkdirSync(macFolder, { recursive: true });
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2026-01-15T00:00:00Z"));
    assert.ok(lstatSync(join(macFolder, "node_modules")).isSymbolicLink());
    assert.equal(readlinkSync(join(macFolder, "node_modules")), join(liveRoot + macFolder, "node_modules"));
});

test("test_fill_writes_no_tracked_files_before_the_repo's_first_commit", (t) => {
    // Scenario: the event is before the HEAD log's first row, whose old hash is all zeros: no commit was checked out yet.
    const root = makeTempFolder(t);
    const liveRoot = join(root, "live");
    const macFolder = join(root, "mac", "repo");
    makeLiveRepoWithTwoCommits(liveRoot + macFolder);
    mkdirSync(macFolder, { recursive: true });
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2025-12-01T00:00:00Z"));
    assert.equal(existsSync(join(macFolder, "notes.txt")), false);
});

test("test_fill_writes_a_submodule's_tracked_files_at_the_commit_the_parent_commit_records", (t) => {
    // Scenario: the parent commit records the submodule at its first commit; today the submodule is at its second.
    const root = makeTempFolder(t);
    const liveRoot = join(root, "live");
    const macFolder = join(root, "mac", "parent");
    const submoduleSource = join(root, "submodule-source");
    makeLiveRepoWithTwoCommits(submoduleSource);
    const liveParent = liveRoot + macFolder;
    mkdirSync(liveParent, { recursive: true });
    runGitAtTime(liveParent, FIRST_COMMIT_TIME, ["init", "-q", "-b", "master"]);
    runGitAtTime(liveParent, FIRST_COMMIT_TIME, ["submodule", "add", "-q", submoduleSource, "inner"]);
    runGitAtTime(join(liveParent, "inner"), FIRST_COMMIT_TIME, ["checkout", "-q", "HEAD~1"]);
    runGitAtTime(liveParent, FIRST_COMMIT_TIME, ["commit", "-q", "-am", "add inner at its first commit"]);
    runGitAtTime(join(liveParent, "inner"), SECOND_COMMIT_TIME, ["checkout", "-q", "master"]);
    mkdirSync(macFolder, { recursive: true });
    fillOutsideGitFoldersAtTime([new Path(macFolder)], liveRoot, new Date("2026-01-15T00:00:00Z"));
    assert.equal(readFileSync(join(macFolder, "inner", "notes.txt"), "utf8"), "one\n");
    // the submodule's .git file is reachable, so a recorded `git -C <submodule>` call finds the module repo
    assert.equal(readlinkSync(join(macFolder, "inner", ".git")), join(liveParent, "inner", ".git"));
});
