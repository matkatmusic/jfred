// engineV3 RepoState: the files git tracks plus untracked, not-ignored files, as bytes keyed by relative path.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RepoState, findRepoStateDifferences, isRepoStateEqual, readRepoState } from "../src/engine_v3_repo_state.ts";

// Write `content` at `relativePath` under `root`, creating parent folders as needed.
function writeFixtureFile(root: string, relativePath: string, content: string | Buffer): void {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
}

// An empty git repo in a fresh temp folder.
function makeEmptyRepo(t: TestContext): Path {
    const root = mkdtempSync(join(tmpdir(), "engine-v3-repo-state-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    execSync("git init -q", { cwd: root });
    return new Path(root);
}

// Stage every file in the repo so git tracks it.
function trackAllFiles(repo: Path): void {
    execSync("git add -A", { cwd: repo.toString() });
}

// A state holding the given path and content pairs.
function makeState(entries: Array<[string, string]>): RepoState {
    const state = new RepoState();
    for (const [relativePath, content] of entries) {
        state.set(new Path(relativePath), Buffer.from(content));
    }
    return state;
}

// The path lists as plain strings, for comparison.
function listPathNames(paths: Path[]): string[] {
    const names: string[] = [];
    for (const path of paths) {
        names.push(path.toString());
    }
    return names;
}

test("test_readRepoState_includes_tracked_file_with_exact_bytes", (t) => {
    // Scenario: a binary tracked file appears in the state with the same bytes.
    const repo = makeEmptyRepo(t);
    const bytes = Buffer.from([0, 255, 10]);
    writeFixtureFile(repo.toString(), "tracked.bin", bytes);
    trackAllFiles(repo);
    const state = readRepoState(repo);
    assert.deepEqual(state.get(new Path("tracked.bin")), bytes);
});

test("test_readRepoState_includes_untracked_file_that_is_not_ignored", (t) => {
    // Scenario: a file git does not track and does not ignore is in the state.
    const repo = makeEmptyRepo(t);
    writeFixtureFile(repo.toString(), "loose.txt", "loose");
    const state = readRepoState(repo);
    assert.equal(state.get(new Path("loose.txt"))?.toString(), "loose");
});

test("test_readRepoState_excludes_gitignored_file", (t) => {
    // Scenario: a file matching .gitignore is not in the state.
    const repo = makeEmptyRepo(t);
    writeFixtureFile(repo.toString(), ".gitignore", "*.log\n");
    writeFixtureFile(repo.toString(), "debug.log", "log");
    const state = readRepoState(repo);
    assert.equal(state.containsPath(new Path("debug.log")), false);
    assert.equal(state.containsPath(new Path(".gitignore")), true);
});

test("test_readRepoState_excludes_tracked_file_deleted_from_disk", (t) => {
    // Scenario: git still lists the file, but it is gone from disk, so the state skips it.
    const repo = makeEmptyRepo(t);
    writeFixtureFile(repo.toString(), "gone.txt", "gone");
    trackAllFiles(repo);
    rmSync(join(repo.toString(), "gone.txt"));
    const state = readRepoState(repo);
    assert.equal(state.containsPath(new Path("gone.txt")), false);
});

test("test_readRepoState_excludes_everything_under_dot_git", (t) => {
    // Scenario: no path in the state starts with .git/.
    const repo = makeEmptyRepo(t);
    writeFixtureFile(repo.toString(), "a.txt", "a");
    trackAllFiles(repo);
    const names = listPathNames(readRepoState(repo).listPaths());
    assert.deepEqual(names, ["a.txt"]);
});

test("test_readRepoState_keys_subfolder_file_by_relative_path", (t) => {
    // Scenario: a file in a subfolder has the key "sub/file.txt".
    const repo = makeEmptyRepo(t);
    writeFixtureFile(repo.toString(), "sub/file.txt", "deep");
    const names = listPathNames(readRepoState(repo).listPaths());
    assert.deepEqual(names, ["sub/file.txt"]);
});

test("test_readRepoState_throws_when_folder_is_not_a_git_repo", (t) => {
    // Scenario: a plain folder has no repo, so the reader throws.
    const folder = new Path(mkdtempSync(join(tmpdir(), "engine-v3-not-a-repo-")));
    t.after(() => rmSync(folder.toString(), { recursive: true, force: true }));
    assert.throws(() => readRepoState(folder), /not a git repo/);
});

test("test_removePath_removes_the_path_from_the_state", () => {
    // Scenario: after removePath, the state no longer holds that path but keeps the others.
    const state = makeState([["a.txt", "a"], ["b.txt", "b"]]);
    state.removePath(new Path("a.txt"));
    assert.equal(state.containsPath(new Path("a.txt")), false);
    assert.equal(state.containsPath(new Path("b.txt")), true);
});

test("test_findRepoStateDifferences_reports_nothing_for_equal_states", () => {
    // Scenario: two states with the same paths and bytes have no differences.
    const expected = makeState([["a.txt", "a"]]);
    const actual = makeState([["a.txt", "a"]]);
    const differences = findRepoStateDifferences(expected, actual);
    assert.deepEqual(differences, { onlyInExpected: [], onlyInActual: [], changedContent: [] });
    assert.equal(isRepoStateEqual(expected, actual), true);
});

test("test_findRepoStateDifferences_reports_changed_byte_in_changedContent", () => {
    // Scenario: one file differs by one byte.
    const expected = makeState([["a.txt", "aaa"], ["b.txt", "b"]]);
    const actual = makeState([["a.txt", "aab"], ["b.txt", "b"]]);
    const differences = findRepoStateDifferences(expected, actual);
    assert.deepEqual(listPathNames(differences.changedContent), ["a.txt"]);
    assert.equal(isRepoStateEqual(expected, actual), false);
});

test("test_findRepoStateDifferences_reports_path_only_in_expected", () => {
    // Scenario: a file only the expected state holds is listed, sorted, in onlyInExpected.
    const expected = makeState([["z.txt", "z"], ["a.txt", "a"]]);
    const actual = makeState([]);
    const differences = findRepoStateDifferences(expected, actual);
    assert.deepEqual(listPathNames(differences.onlyInExpected), ["a.txt", "z.txt"]);
    assert.deepEqual(differences.onlyInActual, []);
});

test("test_findRepoStateDifferences_reports_path_only_in_actual", () => {
    // Scenario: a file only the actual state holds is listed in onlyInActual.
    const expected = makeState([]);
    const actual = makeState([["extra.txt", "x"]]);
    const differences = findRepoStateDifferences(expected, actual);
    assert.deepEqual(listPathNames(differences.onlyInActual), ["extra.txt"]);
    assert.deepEqual(differences.onlyInExpected, []);
});
