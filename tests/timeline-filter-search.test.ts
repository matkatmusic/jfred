// Timeline search tests for result-hash matching and session-title index edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TIMELINE_FILTER_MODES } from "../webapp/views/timeline-filter-model.ts";
import {
    computeMatchingNodeIndexes,
    computeSessionTitleByNodeIndex,
    isNodeMatchingSearchTerm,
} from "../webapp/views/timeline-filter-search.ts";
import {
    COMMIT_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type TimelineNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";

const commitWithHash: CommitNode = { kind: COMMIT_NODE_KIND, when: "t3", sessionId: "s", resultHash: "ABC123" };
const userTurn: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "s", text: "hi", snapshots: [], gitOperations: [] };

test("test_search_matches_commit_result_hash_case_insensitively", () => {
    // Scenario: a commit row is searchable by its result hash.
    assert.equal(isNodeMatchingSearchTerm(commitWithHash, "abc1"), true);
    assert.equal(isNodeMatchingSearchTerm(userTurn, "abc1"), false);
});

test("test_search_trims_the_term_before_matching", () => {
    // Scenario: spaces around the term do not change the match.
    assert.equal(isNodeMatchingSearchTerm(userTurn, "  hi  "), true);
});

test("test_matching_indexes_combine_mode_and_term", () => {
    // Scenario: Git mode keeps only the commit even when both rows match the term.
    const nodes: TimelineNode[] = [userTurn, commitWithHash];
    assert.deepEqual(computeMatchingNodeIndexes(nodes, TIMELINE_FILTER_MODES.git, ""), [1]);
});

test("test_session_title_index_skips_untitled_sessions", () => {
    // Scenario: a session missing from the title record gets no entry.
    const nodes: TimelineNode[] = [userTurn];
    assert.equal(computeSessionTitleByNodeIndex(nodes, { other: "x" }).size, 0);
});
