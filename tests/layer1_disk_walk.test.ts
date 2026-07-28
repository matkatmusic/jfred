// Task 230 (spec S18): walkCurrentFileState — the on-disk `current file state` of a project
// folder, relative paths plus mtimes, with `.git`, `node_modules` and gitignored paths absent.
// Fixtures are real temp folders; a folder with no .gitignore must still walk (S18: a folder
// the user points at may have none, which is not an error).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { walkCurrentFileState } from "../src/layer1_disk_walk.ts";

// Write `content` at `relativePath` under `root`, creating parent folders as needed.
function writeFixtureFile(root: string, relativePath: string, content: string): void {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
}

// A folder holding two real source files plus every excluded shape: a .git dir, a
// node_modules dir, a gitignored directory (`build/`) and a gitignored glob (`*.log`).
function makeFixtureFolder(): string {
    const root = mkdtempSync(join(tmpdir(), "layer1-disk-walk-"));
    writeFixtureFile(root, ".gitignore", "# comment\n\nbuild/\n*.log\n!keep.log\n");
    writeFixtureFile(root, "README.md", "readme\n");
    writeFixtureFile(root, "src/app.ts", "app\n");
    writeFixtureFile(root, "src/nested/helper.ts", "helper\n");
    writeFixtureFile(root, ".git/config", "[core]\n");
    writeFixtureFile(root, "node_modules/pkg/index.js", "pkg\n");
    writeFixtureFile(root, "build/out.js", "out\n");
    writeFixtureFile(root, "debug.log", "log\n");
    return root;
}

// The walked paths as plain strings, for set comparison.
function listWalkedPaths(root: string): string[] {
    return walkCurrentFileState(new Path(root)).map((file) => file.relativePath.toString());
}

test("test_walkCurrentFileState_returns_every_non_excluded_file_relative_and_sorted", () => {
    // Scenario: the fixture folder yields exactly its non-excluded files, each path relative to
    // the project root and the list sorted for determinism. .gitignore itself is a real tracked
    // file, so it is part of the current file state.
    const root = makeFixtureFolder();
    assert.deepEqual(listWalkedPaths(root), [".gitignore", "README.md", "src/app.ts", "src/nested/helper.ts"]);
});

test("test_walkCurrentFileState_excludes_git_node_modules_and_gitignored_paths", () => {
    // Scenario: the .git dir, the node_modules dir, the gitignored `build/` directory and the
    // gitignored `*.log` glob are all absent — including files nested inside them.
    const walked = listWalkedPaths(makeFixtureFolder());
    for (const excluded of [".git/config", "node_modules/pkg/index.js", "build/out.js", "debug.log"]) {
        assert.equal(walked.includes(excluded), false, `${excluded} should not be walked`);
    }
});

test("test_walkCurrentFileState_walks_a_folder_with_no_gitignore", () => {
    // Scenario: a folder with no .gitignore is not an error — it walks, and `.git` and
    // `node_modules` are still excluded unconditionally.
    const root = mkdtempSync(join(tmpdir(), "layer1-disk-walk-bare-"));
    writeFixtureFile(root, "notes.txt", "notes\n");
    writeFixtureFile(root, "node_modules/pkg/index.js", "pkg\n");
    writeFixtureFile(root, ".git/config", "[core]\n");
    assert.deepEqual(listWalkedPaths(root), ["notes.txt"]);
});

// Run a git command in `folder` with a fixed identity and a pinned committer date.
function runGit(folder: string, command: string): void {
    execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
        cwd: folder,
        stdio: "pipe",
        env: { ...process.env, GIT_COMMITTER_DATE: "2026-07-01T10:00:00Z" },
    });
}

// A REAL repo holding a tracked file, an untracked file, an ignored file (via a NESTED .gitignore
// the fallback matcher cannot read), and a committed submodule whose inner repo has a file of its
// own. `protocol.file.allow=always` is mandatory: modern git refuses a local-path submodule clone.
function makeFixtureRepoWithSubmodule(): string {
    const innerDir = mkdtempSync(join(tmpdir(), "layer1-disk-walk-inner-"));
    runGit(innerDir, "init -q");
    writeFixtureFile(innerDir, "inner.txt", "belongs to another repository\n");
    runGit(innerDir, "add -A");
    runGit(innerDir, "commit -q -m inner");
    const root = mkdtempSync(join(tmpdir(), "layer1-disk-walk-repo-"));
    runGit(root, "init -q");
    writeFixtureFile(root, "kept.txt", "tracked\n");
    runGit(root, "add -A");
    runGit(root, "commit -q -m one");
    runGit(root, `-c protocol.file.allow=always submodule add -q ${innerDir} external/tmux_lib`);
    runGit(root, "commit -q -m submodule");
    writeFixtureFile(root, "untracked.txt", "present but uncommitted\n");
    writeFixtureFile(root, "src/.gitignore", "generated.ts\n");
    writeFixtureFile(root, "src/generated.ts", "machine written\n");
    return root;
}

test("test_walkCurrentFileState_asks_git_and_omits_a_submodules_contents_and_its_gitlink", () => {
    // Scenario: a submodule's files belong to ANOTHER repository, so Layer 1 must not report them
    // at all — the real case is jfred's four submodules holding 10,884 files, every one of which
    // landed in the "No repository match" bucket. The gitlink itself is not a file either.
    // Steps:
    // walk a real repo that holds a tracked file, an untracked file and a submodule.
    const walked = listWalkedPaths(makeFixtureRepoWithSubmodule());
    // the submodule's contents are absent — git stops at the gitlink, so they are never listed.
    assert.equal(walked.some((path) => path.startsWith("external/tmux_lib/")), false, walked.join(","));
    // and the gitlink's own path is absent too: it is a directory on disk, never a file.
    assert.equal(walked.includes("external/tmux_lib"), false, walked.join(","));
});

test("test_walkCurrentFileState_reports_tracked_and_untracked_files_but_not_ignored_ones", () => {
    // Scenario: the `current file state` is what is on disk, which is tracked AND untracked files
    // — but never an ignored one. A NESTED .gitignore governs here, which is exactly what asking
    // git buys over the fallback matcher (that one reads only the TOP-LEVEL .gitignore).
    // Steps:
    // walk the same repo.
    const walked = listWalkedPaths(makeFixtureRepoWithSubmodule());
    // the tracked file, the untracked file and the two .gitignore/.gitmodules files git tracks.
    assert.equal(walked.includes("kept.txt"), true, walked.join(","));
    assert.equal(walked.includes("untracked.txt"), true, walked.join(","));
    // the file ignored by the NESTED src/.gitignore is absent.
    assert.equal(walked.includes("src/generated.ts"), false, walked.join(","));
});

test("test_walkCurrentFileState_reports_the_files_mtime", () => {
    // Scenario: each entry carries the file's mtime as a Date — the Layer-1 timestamp.
    const root = makeFixtureFolder();
    const readme = walkCurrentFileState(new Path(root)).find((file) => file.relativePath.toString() === "README.md");
    assert.ok(readme !== undefined);
    assert.ok(readme.mtime instanceof Date);
    assert.equal(readme.mtime.getTime(), statSync(join(root, "README.md")).mtime.getTime());
});

// Task 298: `createdAt` is the birth instant, believed ONLY when it precedes the mtime.
test("test_walkCurrentFileState_reports_createdAt_only_when_the_birth_precedes_the_mtime", () => {
    const root = makeFixtureFolder();
    const born = statSync(join(root, "README.md")).birthtime;
    utimesSync(join(root, "README.md"), born, new Date(born.getTime() + 60_000));
    utimesSync(join(root, "src/app.ts"), born, new Date(born.getTime() - 60_000));
    const walked = walkCurrentFileState(new Path(root));
    const modifiedLater = walked.find((file) => file.relativePath.toString() === "README.md");
    const modifiedEarlier = walked.find((file) => file.relativePath.toString() === "src/app.ts");
    assert.equal(modifiedLater?.createdAt?.getTime(), born.getTime());
    assert.equal(modifiedEarlier?.createdAt, undefined);
});
