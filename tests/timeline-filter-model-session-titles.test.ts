// Session-title search: a custom title matches its session's FIRST timeline node.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TIMELINE_FILTER_MODES,
} from "../webapp/views/timeline-filter-model.ts";
import {
    computeMatchingNodeIndexes,
    computeSessionTitleByNodeIndex,
    isNodeMatchingSearchTerm,
    isNodePassingFilters,
} from "../webapp/views/timeline-filter-search.ts";
import {
    USER_TURN_NODE_KIND,
    type TimelineNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";

// Fixture nodes: two sessions, session-a titled, session-b untitled.
const firstNodeOfSessionA: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "session-a", text: "hello", snapshots: [], gitOperations: [] };
const secondNodeOfSessionA: TurnNode = { ...firstNodeOfSessionA, when: "t2", text: "more" };
const firstNodeOfSessionB: TurnNode = { ...firstNodeOfSessionA, when: "t3", sessionId: "session-b" };
const SESSION_A_TITLE = "tackle 121";
const SESSION_TITLES: Record<string, string> = { "session-a": SESSION_A_TITLE };

test("test_computeSessionTitleByNodeIndex_maps_each_titled_sessions_first_node", () => {
    // Scenario: only a titled session's first node carries its title.
    const nodes: TimelineNode[] = [firstNodeOfSessionA, secondNodeOfSessionA, firstNodeOfSessionB];
    const titleByNodeIndex = computeSessionTitleByNodeIndex(nodes, SESSION_TITLES);
    assert.deepEqual([...titleByNodeIndex.entries()], [[0, SESSION_A_TITLE]]);
});

test("test_computeSessionTitleByNodeIndex_returns_empty_map_when_document_has_no_titles", () => {
    // Scenario: older cached documents have no sessionTitles, so the map is empty.
    const nodes: TimelineNode[] = [firstNodeOfSessionA, firstNodeOfSessionB];
    assert.equal(computeSessionTitleByNodeIndex(nodes, undefined).size, 0);
});

test("test_isNodeMatchingSearchTerm_matches_the_sessions_title_case_insensitively", () => {
    // Scenario: the title is an extra searchable text for its node.
    assert.equal(isNodeMatchingSearchTerm(firstNodeOfSessionA, "TACKLE 121", SESSION_A_TITLE), true);
    assert.equal(isNodeMatchingSearchTerm(firstNodeOfSessionA, "TACKLE 121"), false);
});

test("test_isNodePassingFilters_still_requires_the_mode_predicate_for_title_matches", () => {
    // Scenario: a title match never overrides the active mode button.
    assert.equal(isNodePassingFilters(firstNodeOfSessionA, TIMELINE_FILTER_MODES.git, "tackle", SESSION_A_TITLE), false);
});

test("test_computeMatchingNodeIndexes_includes_the_titled_sessions_first_node", () => {
    // Scenario: the jump list lands on the titled session's first node only.
    const nodes: TimelineNode[] = [firstNodeOfSessionA, secondNodeOfSessionA];
    const titleByNodeIndex = new Map<number, string>([[0, SESSION_A_TITLE]]);
    assert.deepEqual(computeMatchingNodeIndexes(nodes, TIMELINE_FILTER_MODES.all, "tackle", titleByNodeIndex), [0]);
});
