// Tests for discoverNestedRepos (task 365): finding every git repo at or below a root directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { discoverNestedRepos } from "../src/reconstruction_repo_discovery.ts";

function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "reveng-repo-discovery-"));
}

test("test_returns_root_itself_when_it_is_a_repo", () => {
    // Scenario: the root directory itself has a .git entry.
    const root = makeTempDir();
    mkdirSync(join(root, ".git"));
    // Step: discovery returns just the root.
    const found = discoverNestedRepos(new Path(root));
    assert.deepEqual(found.map((path) => path.toString()), [root]);
});

test("test_finds_one_nested_repo_one_level_deep", () => {
    // Scenario: the root has no .git, but a subdirectory A does.
    const root = makeTempDir();
    mkdirSync(join(root, "A", ".git"), { recursive: true });
    // Step: discovery returns only A, not the non-repo root.
    const found = discoverNestedRepos(new Path(root));
    assert.deepEqual(found.map((path) => path.toString()), [join(root, "A")]);
});

test("test_finds_repo_nested_inside_another_repo", () => {
    // Scenario: A/.git AND A/B/.git both exist (mirrors RevEng/.git + RevEng/jfred/.git).
    const root = makeTempDir();
    mkdirSync(join(root, "A", ".git"), { recursive: true });
    mkdirSync(join(root, "A", "B", ".git"), { recursive: true });
    // Step: discovery keeps walking past the first repo it finds and returns both.
    const found = discoverNestedRepos(new Path(root));
    assert.deepEqual(found.map((path) => path.toString()), [join(root, "A"), join(root, "A", "B")]);
});

test("test_returns_empty_when_no_git_anywhere", () => {
    // Scenario: a plain tree with no .git entry at any level.
    const root = makeTempDir();
    mkdirSync(join(root, "A", "B"), { recursive: true });
    // Step: discovery finds nothing.
    const found = discoverNestedRepos(new Path(root));
    assert.deepEqual(found, []);
});

test("test_skips_node_modules_subtree", () => {
    // Scenario: a .git buried under node_modules/pkg/.git — a vendored dependency, not a real repo.
    const root = makeTempDir();
    mkdirSync(join(root, "node_modules", "pkg", ".git"), { recursive: true });
    // Step: discovery never descends into node_modules, so nothing is returned.
    const found = discoverNestedRepos(new Path(root));
    assert.deepEqual(found, []);
});
