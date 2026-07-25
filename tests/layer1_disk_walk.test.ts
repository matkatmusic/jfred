// Task 230 (spec S18): walkCurrentFileState — the on-disk `current file state` of a project
// folder, relative paths plus mtimes, with `.git`, `node_modules` and gitignored paths absent.
// Fixtures are real temp folders; a folder with no .gitignore must still walk (S18: a folder
// the user points at may have none, which is not an error).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
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

test("test_walkCurrentFileState_reports_the_files_mtime", () => {
    // Scenario: each entry carries the file's mtime as a Date (the Layer-1 timestamp; birthtime
    // is deliberately never read).
    const root = makeFixtureFolder();
    const readme = walkCurrentFileState(new Path(root)).find((file) => file.relativePath.toString() === "README.md");
    assert.ok(readme !== undefined);
    assert.ok(readme.mtime instanceof Date);
    assert.equal(readme.mtime.getTime(), statSync(join(root, "README.md")).mtime.getTime());
});
