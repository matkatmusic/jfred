// Task 230 (S18): listCurrentFileState returns relative paths and mtimes, minus .git, node_modules and ignored paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { readCreatedState, listCurrentFileState } from "../src/layer1_disk_walk.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";

// Write `content` at `relativePath` under `root`, creating parent folders as needed.
function writeFixtureFile(root: string, relativePath: string, content: string): void {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
}

// A folder with two source files plus every excluded shape: .git, node_modules, `build/` and `*.log`.
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
    return listCurrentFileState(new Path(root)).map((file) => file.relativePath.toString());
}

test("test_listCurrentFileState_returns_every_non_excluded_file_relative_and_sorted", () => {
    // Scenario: the fixture yields exactly its non-excluded files, relative to the root and sorted.
    const root = makeFixtureFolder();
    assert.deepEqual(listWalkedPaths(root), [".gitignore", "README.md", "src/app.ts", "src/nested/helper.ts"]);
});

test("test_listCurrentFileState_excludes_git_node_modules_and_gitignored_paths", () => {
    // Scenario: .git, node_modules, the ignored `build/` and the ignored `*.log` are absent, nested files included.
    const walked = listWalkedPaths(makeFixtureFolder());
    for (const excluded of [".git/config", "node_modules/pkg/index.js", "build/out.js", "debug.log"]) {
        assert.equal(walked.includes(excluded), false, `${excluded} should not be walked`);
    }
});

test("test_listCurrentFileState_walks_a_folder_with_no_gitignore", () => {
    // Scenario: a folder with no .gitignore still walks; .git and node_modules stay excluded.
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

// A real repo with tracked, untracked and nested-ignored files plus a submodule; git refuses local submodules without protocol.file.allow.
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

test("test_listCurrentFileState_asks_git_and_omits_a_submodules_contents_and_its_gitlink", () => {
    // Scenario: submodule files belong to another repository, so neither they nor the gitlink are listed.
    const walked = listWalkedPaths(makeFixtureRepoWithSubmodule());
    // git stops at the gitlink, so the submodule contents are never listed.
    assert.equal(walked.some((path) => path.startsWith("external/tmux_lib/")), false, walked.join(","));
    // the gitlink is a directory on disk, never a file.
    assert.equal(walked.includes("external/tmux_lib"), false, walked.join(","));
});

test("test_listCurrentFileState_reports_tracked_and_untracked_files_but_not_ignored_ones", () => {
    // Scenario: tracked and untracked files are listed; a NESTED .gitignore hides its match, which the fallback matcher cannot do.
    const walked = listWalkedPaths(makeFixtureRepoWithSubmodule());
    assert.equal(walked.includes("kept.txt"), true, walked.join(","));
    assert.equal(walked.includes("untracked.txt"), true, walked.join(","));
    // the file ignored by the NESTED src/.gitignore is absent.
    assert.equal(walked.includes("src/generated.ts"), false, walked.join(","));
});

test("test_listCurrentFileState_reports_the_files_mtime", () => {
    // Scenario: each entry carries the file's mtime as a Date, the Layer-1 timestamp.
    const root = makeFixtureFolder();
    const readme = listCurrentFileState(new Path(root)).find((file) => file.relativePath.toString() === "README.md");
    assert.ok(readme !== undefined);
    assert.ok(readme.mtime instanceof Date);
    assert.equal(readme.mtime.getTime(), statSync(join(root, "README.md")).mtime.getTime());
});

// Task 298: `createdAt` is the birth instant, believed ONLY when it precedes the mtime.
test("test_listCurrentFileState_reports_createdAt_only_when_the_birth_precedes_the_mtime", () => {
    const root = makeFixtureFolder();
    const born = statSync(join(root, "README.md")).birthtime;
    utimesSync(join(root, "README.md"), born, new Date(born.getTime() + 60_000));
    utimesSync(join(root, "src/app.ts"), born, new Date(born.getTime() - 60_000));
    const walked = listCurrentFileState(new Path(root));
    const modifiedLater = walked.find((file) => file.relativePath.toString() === "README.md");
    const modifiedEarlier = walked.find((file) => file.relativePath.toString() === "src/app.ts");
    assert.equal(modifiedLater?.createdAt?.getTime(), born.getTime());
    assert.equal(modifiedEarlier?.createdAt, undefined);
    assert.equal(modifiedEarlier?.createdNotTrusted, CreatedNotTrustedReason.birthNotBeforeMtime);
});

test("test_readCreatedState_keeps_the_reason_for_each_dropped_birth_time", () => {
    // Scenario: epoch-0 birth gives noBirthTime; birth at or after mtime gives birthNotBeforeMtime; earlier birth is kept.
    const mtime = new Date("2026-07-01T10:00:00Z");
    assert.deepEqual(readCreatedState({ birthtime: new Date(0), mtime }), { createdNotTrusted: CreatedNotTrustedReason.noBirthTime });
    assert.deepEqual(readCreatedState({ birthtime: mtime, mtime }), { createdNotTrusted: CreatedNotTrustedReason.birthNotBeforeMtime });
    const earlier = new Date("2026-07-01T09:00:00Z");
    assert.deepEqual(readCreatedState({ birthtime: earlier, mtime }), { createdAt: earlier });
});
