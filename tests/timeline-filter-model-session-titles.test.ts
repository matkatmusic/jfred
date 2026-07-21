// Session-title search (timeline-filter-model.ts, task 148) — split from
// timeline-filter-model.test.ts (that file sits at the 250-line cap). A session's user-given
// custom title matches its FIRST timeline node, so typing the title jumps to the row directly
// under that session's header marker.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TIMELINE_FILTER_MODES,
    checkNodeMatchesSearchTerm,
    checkNodePassesFilters,
    computeMatchingNodeIndexes,
    computeSessionTitleByNodeIndex,
} from "../webapp/views/timeline-filter-model.ts";
import {
    USER_TURN_NODE_KIND,
    type TimelineNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";

// ── fixture nodes: two sessions, session-a titled, session-b untitled ───────────────────────────
const firstNodeOfSessionA: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "session-a", text: "hello", snapshots: [], gitOperations: [] };
const secondNodeOfSessionA: TurnNode = { ...firstNodeOfSessionA, when: "t2", text: "more" };
const firstNodeOfSessionB: TurnNode = { ...firstNodeOfSessionA, when: "t3", sessionId: "session-b" };
const SESSION_A_TITLE = "tackle 121";
const SESSION_TITLES: Record<string, string> = { "session-a": SESSION_A_TITLE };

test("test_computeSessionTitleByNodeIndex_maps_each_titled_sessions_first_node", () => {
    // Scenario: only a titled session's FIRST node carries its title in the search.
    // Steps: over [a1, a2, b1] with only session-a titled, the map holds exactly one entry —
    // index 0 (session-a's first node) → the title; a2 (same session) and b1 (untitled) get none.
    const nodes: TimelineNode[] = [firstNodeOfSessionA, secondNodeOfSessionA, firstNodeOfSessionB];
    const titleByNodeIndex = computeSessionTitleByNodeIndex(nodes, SESSION_TITLES);
    assert.deepEqual([...titleByNodeIndex.entries()], [[0, SESSION_A_TITLE]]);
});

test("test_computeSessionTitleByNodeIndex_returns_empty_map_when_document_has_no_titles", () => {
    // Scenario: older cached documents predate sessionTitles — the map is simply empty.
    // Steps: same nodes, undefined titles → no entries.
    const nodes: TimelineNode[] = [firstNodeOfSessionA, firstNodeOfSessionB];
    assert.equal(computeSessionTitleByNodeIndex(nodes, undefined).size, 0);
});

test("test_checkNodeMatchesSearchTerm_matches_the_sessions_title_case_insensitively", () => {
    // Scenario: the title is an extra haystack for the node it is attached to.
    // Steps: the node's own text ("hello") does not contain the term; with the title supplied
    // the uppercased term matches; without the title the same call does not.
    assert.equal(checkNodeMatchesSearchTerm(firstNodeOfSessionA, "TACKLE 121", SESSION_A_TITLE), true);
    assert.equal(checkNodeMatchesSearchTerm(firstNodeOfSessionA, "TACKLE 121"), false);
});

test("test_checkNodePassesFilters_still_requires_the_mode_predicate_for_title_matches", () => {
    // Scenario: a title match never overrides the active mode button.
    // Steps: a user turn under the "Git" mode fails the mode predicate, so even a matching
    // title leaves the row hidden.
    assert.equal(checkNodePassesFilters(firstNodeOfSessionA, TIMELINE_FILTER_MODES.git, "tackle", SESSION_A_TITLE), false);
});

test("test_computeMatchingNodeIndexes_includes_the_titled_sessions_first_node", () => {
    // Scenario: the jump list lands on the titled session's first node — the row directly
    // under its session-start marker.
    // Steps: neither node's text contains "tackle"; the per-index title map attaches the
    // title to index 0 only, so the result list is exactly [0].
    const nodes: TimelineNode[] = [firstNodeOfSessionA, secondNodeOfSessionA];
    const titleByNodeIndex = new Map<number, string>([[0, SESSION_A_TITLE]]);
    assert.deepEqual(computeMatchingNodeIndexes(nodes, TIMELINE_FILTER_MODES.all, "tackle", titleByNodeIndex), [0]);
});
