import { test } from "node:test";
import assert from "node:assert/strict";
import { findSurvivingHead } from "../src/reconstruction_surviving_head.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { createRecord, createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

test("test_find_surviving_head_returns_undefined_without_heads", () => {
    assert.equal(findSurvivingHead([]), undefined);
});

test("test_find_surviving_head_returns_final_head_without_working_tree_owner", () => {
    const records = [
        createRecord(RecordType.user, "R", null),
        createRecord(RecordType.assistant, "A", "R"),
        createLastPromptRecord("A"),
    ];
    assert.equal(findSurvivingHead(records)!.toString(), "A");
});
