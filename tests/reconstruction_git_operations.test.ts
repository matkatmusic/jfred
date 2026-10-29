import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCommitHashFromResultText, splitCompoundCommandSegments } from "../src/reconstruction_git_operations.ts";

test("test_split_compound_command_trims_each_segment", () => {
    assert.deepEqual(splitCompoundCommandSegments("git add a  &&  git commit -m x"), ["git add a", "git commit -m x"]);
});

test("test_split_single_command_returns_one_segment", () => {
    assert.deepEqual(splitCompoundCommandSegments("git status"), ["git status"]);
});

test("test_extract_hash_from_summary_line", () => {
    assert.equal(extractCommitHashFromResultText("[master 4fa08d2] fix: x"), "4fa08d2");
});

test("test_extract_hash_from_root_commit_summary_line", () => {
    assert.equal(extractCommitHashFromResultText("[master (root-commit) ab12cd3] init"), "ab12cd3");
});

test("test_extract_hash_falls_back_to_bare_token", () => {
    assert.equal(extractCommitHashFromResultText("ok 928eaa9"), "928eaa9");
});

test("test_extract_hash_without_hash_is_undefined", () => {
    assert.equal(extractCommitHashFromResultText("nothing to commit"), undefined);
});
