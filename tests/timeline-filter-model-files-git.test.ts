// Timeline filter mode predicate tests for Files, Git, session-end rows, and the merged baseline.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TIMELINE_FILTER_MODES,
    isNodeInFilterMode,
} from "../webapp/views/timeline-filter-model.ts";
import { SCRIPT_EXECUTION_EVENT_KIND } from "../webapp/views/timeline-labels-pills.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    EDIT_EVENT_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type SessionEndNode,
    type ToolCallNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";

// Fixture nodes: one minimal literal per shape the predicate distinguishes.
const userTurn: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "s", text: "hi", snapshots: [], gitOperations: [] };
const agentTurn: TurnNode = { kind: AGENT_TURN_NODE_KIND, when: "t2", sessionId: "s", text: "ok", snapshots: [], gitOperations: [] };
const agentTurnWithScriptChange: TurnNode = { ...agentTurn, fileChanges: [{ path: "a.py", displayPath: "a.py", eventKind: SCRIPT_EXECUTION_EVENT_KIND, renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: "t2" }] };
const agentTurnWithEditChange: TurnNode = { ...agentTurn, fileChanges: [{ path: "a.py", displayPath: "a.py", eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "t2" }] };
const sessionEnd: SessionEndNode = { kind: SESSION_END_NODE_KIND, when: "t9", sessionId: "s", snapshots: [] };
const commit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t3", sessionId: "s" };
const plainToolCall: ToolCallNode = { kind: TOOL_CALL_NODE_KIND, when: "t4", sessionId: "s", uuid: "u1", toolName: "Grep", summary: "grep foo", toolUseId: "tu1" };
const scriptToolCall: ToolCallNode = { ...plainToolCall, uuid: "u2", toolUseId: "tu2", scriptRun: { timestamp: "t4", code: "print()", changedPaths: ["a.py"] } };
const readOnlyScriptToolCall: ToolCallNode = { ...plainToolCall, uuid: "u3", toolUseId: "tu3", scriptRun: { timestamp: "t4", code: "print()", changedPaths: [] } };
// The merged git-derived baseline row is still a commit node, now carrying chips.
const mergedBaselineCommit: CommitNode = { ...commit, isGitBaseline: true, fileChanges: [{ path: "orders.py", displayPath: "orders.py", eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: true, changeId: "gitBase:abc:orders.py", when: "t3" }] };

test("test_files_mode_matches_node_with_file_changes", () => {
    // Scenario: "Files" keeps rows carrying file-change chips, whatever made the change.
    assert.equal(isNodeInFilterMode(agentTurnWithEditChange, TIMELINE_FILTER_MODES.files), true);
    assert.equal(isNodeInFilterMode(agentTurnWithScriptChange, TIMELINE_FILTER_MODES.files), true);
});

test("test_files_mode_matches_tool_call_whose_script_run_changed_files", () => {
    // Scenario: "Files" keeps script-run rows only when the run changed files.
    assert.equal(isNodeInFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.files), true);
    assert.equal(isNodeInFilterMode(readOnlyScriptToolCall, TIMELINE_FILTER_MODES.files), false);
});

test("test_files_mode_rejects_nodes_without_file_changes", () => {
    // Scenario: "Files" hides rows that touched no files.
    assert.equal(isNodeInFilterMode(userTurn, TIMELINE_FILTER_MODES.files), false);
    assert.equal(isNodeInFilterMode(agentTurn, TIMELINE_FILTER_MODES.files), false);
    assert.equal(isNodeInFilterMode(plainToolCall, TIMELINE_FILTER_MODES.files), false);
    assert.equal(isNodeInFilterMode(commit, TIMELINE_FILTER_MODES.files), false);
});

test("test_git_mode_matches_only_commit_nodes", () => {
    // Scenario: "Git" keeps commit rows and hides turns and tool calls.
    assert.equal(isNodeInFilterMode(commit, TIMELINE_FILTER_MODES.git), true);
    assert.equal(isNodeInFilterMode(userTurn, TIMELINE_FILTER_MODES.git), false);
    assert.equal(isNodeInFilterMode(plainToolCall, TIMELINE_FILTER_MODES.git), false);
    assert.equal(isNodeInFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.git), false);
});

test("test_session_end_matches_every_mode", () => {
    // Scenario: session-end terminators anchor each session's extent, so no mode hides them.
    for (const mode of Object.values(TIMELINE_FILTER_MODES)) {
        assert.equal(isNodeInFilterMode(sessionEnd, mode), true);
    }
});

test("test_merged_baseline_commit_row_matches_git_and_files_modes", () => {
    // Scenario: the merged baseline row matches Git as a commit and Files through its chips.
    assert.equal(isNodeInFilterMode(mergedBaselineCommit, TIMELINE_FILTER_MODES.git), true);
    assert.equal(isNodeInFilterMode(mergedBaselineCommit, TIMELINE_FILTER_MODES.files), true);
});

test("test_merged_baseline_commit_row_leaves_conversation_mode", () => {
    // Scenario: once merged, the baseline is no longer a turn, so Conversation hides it.
    assert.equal(isNodeInFilterMode(mergedBaselineCommit, TIMELINE_FILTER_MODES.conversation), false);
});
