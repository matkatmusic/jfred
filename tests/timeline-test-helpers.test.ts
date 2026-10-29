import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import {
  S39_SEED_JSONL_PATH,
  commitWalkDocument,
  findCommitNodeIndexes,
  s2Document,
  s39SeedDocument,
  s45Document,
  s84Document,
  s85Document,
} from "./timeline-test-helpers.ts";

test("test_find_commit_node_indexes_returns_commit_positions_in_order", () => {
    // Scenario: only commit-kind nodes contribute their index.
    const nodes = [{ kind: "x" }, { kind: COMMIT_NODE_KIND }, { kind: "y" }, { kind: COMMIT_NODE_KIND }];
    assert.deepEqual(findCommitNodeIndexes(nodes), [1, 3]);
});

test("test_find_commit_node_indexes_returns_empty_without_commits", () => {
    // Scenario: no commit nodes gives an empty list.
    assert.deepEqual(findCommitNodeIndexes([{ kind: "x" }]), []);
});

test("test_commit_walk_document_holds_six_replies_and_two_commits", () => {
    // Scenario: the fixture has one prompt, five replies, and two commit git operations.
    assert.equal(commitWalkDocument.messages.length, 6);
    assert.equal(commitWalkDocument.gitOperations.length, 2);
});

test("test_seed_jsonl_path_names_the_seed_session", () => {
    // Scenario: the s39 seed path is the transcript whose name holds the seed session prefix.
    assert.ok(S39_SEED_JSONL_PATH.toString().includes("b9783f4b"));
});

test("test_project_documents_carry_messages_and_steps", () => {
    // Scenario: every prebuilt wire document has the message and step arrays tests read.
    for (const document of [s84Document, s85Document, s2Document, s45Document, s39SeedDocument]) {
        assert.ok(Array.isArray(document.messages));
        assert.ok(Array.isArray(document.steps));
    }
});
