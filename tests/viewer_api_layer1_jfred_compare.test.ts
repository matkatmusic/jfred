// Section S6: listDeletedPaths on a temp repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listDeletedPaths } from "../src/viewer_api_layer1_jfred_compare.ts";
import { Path } from "../src/structures/domain.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";

test("test_path_absent_at_the_mark_and_held_by_the_parent_is_listed_as_deleted", () => {
    // Setup: the parent holds sub/b.txt and the reader says it is absent.
    const repo = createJfredTempRepo();
    // Verify: the path is listed.
    assert.deepEqual(listDeletedPaths(new Path(repo.repoDir), repo.commitHashes[1]!, new Map(), new Set(["sub/b.txt"])), ["sub/b.txt"]);
});

test("test_path_absent_in_parent_is_not_a_change", () => {
    // Setup: the reader says nope.txt is absent, and the parent never held it.
    const repo = createJfredTempRepo();
    // Verify: nothing is listed.
    assert.deepEqual(listDeletedPaths(new Path(repo.repoDir), repo.commitHashes[1]!, new Map(), new Set(["nope.txt"])), []);
});

test("test_path_not_in_texts_and_not_absent_keeps_parent_bytes", () => {
    // Setup: the reader knows a.txt as text and says nothing about sub/b.txt or run.sh.
    const repo = createJfredTempRepo();
    // Verify: no path is listed as deleted.
    assert.deepEqual(listDeletedPaths(new Path(repo.repoDir), repo.commitHashes[1]!, new Map([["a.txt", "text"]]), new Set()), []);
});

test("test_path_in_texts_and_absent_throws", () => {
    // Setup: a.txt is in both the texts and the absent paths.
    const repo = createJfredTempRepo();
    // Verify: listing throws.
    assert.throws(() => listDeletedPaths(new Path(repo.repoDir), repo.commitHashes[1]!, new Map([["a.txt", "text"]]), new Set(["a.txt"])), /a\.txt/);
});
