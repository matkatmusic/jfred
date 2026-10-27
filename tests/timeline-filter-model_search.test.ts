// Timeline keyword search predicate and filter button tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TIMELINE_FILTER_MODES,
    TIMELINE_FILTER_BUTTONS,
} from "../webapp/views/timeline-filter-model.ts";
import {
    computeMatchingNodeIndexes,
    isNodeMatchingSearchTerm,
    isNodePassingFilters,
} from "../webapp/views/timeline-filter-search.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    EDIT_EVENT_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type SessionEndNode,
    type TimelineNode,
    type ToolCallNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";

// Fixture nodes: one minimal literal per shape the predicate distinguishes.
const userTurn: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "s", text: "hi", snapshots: [], gitOperations: [] };
const agentTurn: TurnNode = { kind: AGENT_TURN_NODE_KIND, when: "t2", sessionId: "s", text: "ok", snapshots: [], gitOperations: [] };
const sessionEnd: SessionEndNode = { kind: SESSION_END_NODE_KIND, when: "t9", sessionId: "s", snapshots: [] };
const commit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t3", sessionId: "s" };
const plainToolCall: ToolCallNode = { kind: TOOL_CALL_NODE_KIND, when: "t4", sessionId: "s", uuid: "u1", toolName: "Grep", summary: "grep foo", toolUseId: "tu1" };
const agentTurnWithRenameChip: TurnNode = { ...agentTurn, fileChanges: [{ path: "/repo/core_inventory.py", displayPath: "/repo/inventory.py", eventKind: EDIT_EVENT_KIND, renamedFrom: "/repo/inventory.py", isFirstRevision: false, changeId: "c9", when: "t2" }] };
const renameToolCall: ToolCallNode = { ...plainToolCall, uuid: "u4", toolUseId: "tu4", toolName: "Bash", summary: "git mv inventory.py core_inventory.py" };
const commitWithDetail: CommitNode = { ...commit, detail: "wip" };

test("test_isNodeMatchingSearchTerm_empty_term_matches_every_node", () => {
    // Scenario: blank and whitespace-only terms match every node.
    assert.equal(isNodeMatchingSearchTerm(userTurn, ""), true);
    assert.equal(isNodeMatchingSearchTerm(userTurn, "   "), true);
    assert.equal(isNodeMatchingSearchTerm(commit, ""), true);
});

test("test_isNodeMatchingSearchTerm_matches_turn_text_case_insensitively", () => {
    // Scenario: the term matches a turn's message text regardless of case.
    assert.equal(isNodeMatchingSearchTerm(userTurn, "HI"), true);
    assert.equal(isNodeMatchingSearchTerm(userTurn, "inventory"), false);
});

test("test_isNodeMatchingSearchTerm_matches_tool_call_summary_and_name", () => {
    // Scenario: a tool-call row is searchable by its tool name and its summary.
    assert.equal(isNodeMatchingSearchTerm(renameToolCall, "bash"), true);
    assert.equal(isNodeMatchingSearchTerm(renameToolCall, "git mv"), true);
});

test("test_isNodeMatchingSearchTerm_matches_commit_detail", () => {
    // Scenario: a commit row is searchable by its message detail.
    assert.equal(isNodeMatchingSearchTerm(commitWithDetail, "wip"), true);
    assert.equal(isNodeMatchingSearchTerm(commit, "wip"), false);
});

test("test_isNodeMatchingSearchTerm_matches_file_chip_paths", () => {
    // Scenario: final, entry-time, and renamed-from chip paths all match the term.
    assert.equal(isNodeMatchingSearchTerm(agentTurnWithRenameChip, "inventory"), true);
    assert.equal(isNodeMatchingSearchTerm(agentTurn, "inventory"), false);
});

test("test_isNodeMatchingSearchTerm_hides_session_end_rows", () => {
    // Scenario: search has no session-end exemption, so a real term hides the terminator.
    assert.equal(isNodeMatchingSearchTerm(sessionEnd, "inventory"), false);
});

test("test_isNodePassingFilters_requires_both_mode_and_term", () => {
    // Scenario: a row stays visible only when it passes the active mode and the term.
    assert.equal(isNodePassingFilters(agentTurnWithRenameChip, TIMELINE_FILTER_MODES.files, "inventory"), true);
    assert.equal(isNodePassingFilters(agentTurnWithRenameChip, TIMELINE_FILTER_MODES.git, "inventory"), false);
    assert.equal(isNodePassingFilters(agentTurnWithRenameChip, TIMELINE_FILTER_MODES.files, "zzz"), false);
});

test("test_computeMatchingNodeIndexes_lists_matching_rows_in_timeline_order", () => {
    // Scenario: the jump list holds the node indexes that pass mode and term, in timeline order.
    const nodes: TimelineNode[] = [agentTurnWithRenameChip, agentTurn, sessionEnd];
    assert.deepEqual(computeMatchingNodeIndexes(nodes, TIMELINE_FILTER_MODES.all, "inventory"), [0]);
    assert.deepEqual(computeMatchingNodeIndexes(nodes, TIMELINE_FILTER_MODES.all, ""), [0, 1, 2]);
});

test("test_filter_buttons_cover_every_mode_with_all_first", () => {
    // Scenario: the button list covers every mode once, with "All" first.
    const orderedModes = TIMELINE_FILTER_BUTTONS.map(([mode]) => mode);
    assert.deepEqual(orderedModes, [
        TIMELINE_FILTER_MODES.all,
        TIMELINE_FILTER_MODES.conversation,
        TIMELINE_FILTER_MODES.tools,
        TIMELINE_FILTER_MODES.scripts,
        TIMELINE_FILTER_MODES.files,
        TIMELINE_FILTER_MODES.git,
    ]);
});
