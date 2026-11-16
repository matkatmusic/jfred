// Task 603: the patch text of one jfred commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readJfredCommitPatch } from "../src/viewer_api_layer1_jfred_patch.ts";
import { Path } from "../src/structures/domain.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";

test("test_readJfredCommitPatch_returns_the_changes_of_that_commit", () => {
    // Scenario: the second commit changes a.txt from "first" to "second".
    // Steps: ask for the patch of the second commit by its short hash.
    const { repoDir, commitHashes } = createJfredTempRepo();
    const patchText = readJfredCommitPatch(new Path(repoDir), commitHashes[1]!.slice(0, 8));
    // Expect: a git header for a.txt, the removed line and the added line, and no commit message.
    assert.match(patchText, /^diff --git a\/a\.txt b\/a\.txt/);
    assert.match(patchText, /^-first$/m);
    assert.match(patchText, /^\+second$/m);
    assert.doesNotMatch(patchText, /C2/);
});

test("test_readJfredCommitPatch_refuses_a_value_that_is_not_a_commit_hash", () => {
    // Scenario: a value that could be read as a git option must never reach git.
    const { repoDir } = createJfredTempRepo();
    assert.throws(() => readJfredCommitPatch(new Path(repoDir), "--output=x"), /not a commit hash/);
});
