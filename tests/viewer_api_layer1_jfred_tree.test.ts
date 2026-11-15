// Section S6: buildTreeWithFiles removes deleted paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildTreeWithFiles } from "../src/viewer_api_layer1_jfred_tree.ts";
import { Path } from "../src/structures/domain.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";

function listTree(repoDir: string, treeish: string): string[] {
    return execFileSync("git", ["ls-tree", "-r", treeish], { cwd: repoDir, encoding: "utf8" }).trim().split("\n");
}

function findLineEndingWith(lines: string[], relativePath: string): string | undefined {
    return lines.find((line) => line.endsWith(`\t${relativePath}`));
}

test("test_absent_path_is_removed_from_the_commit_tree", () => {
    // Setup: delete sub/b.txt from the parent tree and write no file.
    const repo = createJfredTempRepo();
    const parentHash = repo.commitHashes[1]!;
    // Action: build the tree.
    const treeHash = buildTreeWithFiles(new Path(repo.repoDir), parentHash, new Map(), ["sub/b.txt"]);
    // Verify: sub/b.txt is gone; a.txt and run.sh keep their blobs and modes.
    const parentLines = listTree(repo.repoDir, parentHash);
    const treeLines = listTree(repo.repoDir, treeHash);
    assert.equal(findLineEndingWith(treeLines, "sub/b.txt"), undefined);
    assert.equal(findLineEndingWith(treeLines, "a.txt"), findLineEndingWith(parentLines, "a.txt"));
    assert.equal(findLineEndingWith(treeLines, "run.sh"), findLineEndingWith(parentLines, "run.sh"));
    assert.match(findLineEndingWith(treeLines, "run.sh")!, /^100755 /);
});

test("test_tree_with_only_deleted_paths_builds_without_blob_files", () => {
    // Setup and action: zero files, one deleted path (hash-object with zero files exits 128).
    const repo = createJfredTempRepo();
    const treeHash = buildTreeWithFiles(new Path(repo.repoDir), repo.commitHashes[1]!, new Map(), ["a.txt"]);
    // Verify: the tree holds the other two files.
    assert.equal(listTree(repo.repoDir, treeHash).length, 2);
});
