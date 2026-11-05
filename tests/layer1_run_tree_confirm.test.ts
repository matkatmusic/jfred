// Task 358 part T: working-tree confirm returns true only for an equal regular file inside the folder.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMatchingWorkingTree } from "../src/layer1_run_tree_confirm.ts";
import { Path } from "../src/structures/domain.ts";

function makeFolderWithFile(name: string, content: string): Path {
  const folder = mkdtempSync(join(tmpdir(), "tree-confirm-"));
  writeFileSync(join(folder, name), content);
  return new Path(folder);
}

test("test_isMatchingWorkingTree_is_true_for_equal_content", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  assert.equal(isMatchingWorkingTree(dir, new Path("a.py"), "one\n"), true);
});

test("test_isMatchingWorkingTree_is_false_for_different_content", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  assert.equal(isMatchingWorkingTree(dir, new Path("a.py"), "two\n"), false);
});

test("test_isMatchingWorkingTree_is_false_for_a_missing_file", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  assert.equal(isMatchingWorkingTree(dir, new Path("missing.py"), "one\n"), false);
});

test("test_isMatchingWorkingTree_is_false_for_a_path_that_leaves_the_folder", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  const outside = makeFolderWithFile("secret.py", "one\n");
  const escape = join("..", outside.toString().split("/").pop()!, "secret.py");
  assert.equal(isMatchingWorkingTree(dir, new Path(escape), "one\n"), false);
});

test("test_isMatchingWorkingTree_is_false_for_a_directory", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  mkdirSync(join(dir.toString(), "sub"));
  assert.equal(isMatchingWorkingTree(dir, new Path("sub"), ""), false);
});

test("test_isMatchingWorkingTree_is_false_for_a_link_that_points_outside_the_folder", () => {
  const dir = makeFolderWithFile("a.py", "one\n");
  const outside = makeFolderWithFile("secret.py", "one\n");
  symlinkSync(join(outside.toString(), "secret.py"), join(dir.toString(), "link.py"));
  assert.equal(isMatchingWorkingTree(dir, new Path("link.py"), "one\n"), false);
});
