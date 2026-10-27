import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitCommandWords } from "../src/reconstruction_git_command_words.ts";
import { GitOperationKind } from "../src/structures/vocabulary_views.ts";

test("test_commit_detail_is_unquoted_message", () => {
    const words = parseGitCommandWords('git commit -m "fix: x"');
    assert.equal(words.kind, GitOperationKind.commit);
    assert.equal(words.detail, "fix: x");
});

test("test_global_flags_with_argument_are_skipped", () => {
    const words = parseGitCommandWords("git -C /repo -c a=b add -A src/a.ts src/b.ts");
    assert.equal(words.kind, GitOperationKind.add);
    assert.equal(words.detail, "src/a.ts src/b.ts");
});

test("test_branch_and_checkout_detail_is_first_non_flag_argument", () => {
    assert.equal(parseGitCommandWords("git checkout -b feature").detail, "feature");
    assert.equal(parseGitCommandWords("git branch -d old").detail, "old");
});

test("test_unknown_subcommand_is_other_with_empty_detail", () => {
    const words = parseGitCommandWords("git frobnicate now");
    assert.equal(words.kind, GitOperationKind.other);
    assert.equal(words.detail, "");
});

test("test_commit_without_message_flag_has_empty_detail", () => {
    assert.equal(parseGitCommandWords("git commit --amend").detail, "");
});
