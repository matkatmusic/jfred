// Timeline filter mode predicate tests for All, Conversation, Tools, and Scripts.

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
    type TimelineNode,
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
const EVERY_FIXTURE_NODE: TimelineNode[] = [userTurn, agentTurn, agentTurnWithScriptChange, agentTurnWithEditChange, sessionEnd, commit, plainToolCall, scriptToolCall, readOnlyScriptToolCall];

test("test_all_mode_matches_every_node_kind", () => {
    // Scenario: "All" is the default mode and hides nothing.
    for (const node of EVERY_FIXTURE_NODE) {
        assert.equal(isNodeInFilterMode(node, TIMELINE_FILTER_MODES.all), true);
    }
});

test("test_conversation_mode_matches_user_and_agent_turns", () => {
    // Scenario: "Conversation" keeps user prompts and agent replies.
    assert.equal(isNodeInFilterMode(userTurn, TIMELINE_FILTER_MODES.conversation), true);
    assert.equal(isNodeInFilterMode(agentTurn, TIMELINE_FILTER_MODES.conversation), true);
});

test("test_conversation_mode_rejects_tool_call_and_commit_nodes", () => {
    // Scenario: "Conversation" hides tool-call and commit rows.
    assert.equal(isNodeInFilterMode(plainToolCall, TIMELINE_FILTER_MODES.conversation), false);
    assert.equal(isNodeInFilterMode(commit, TIMELINE_FILTER_MODES.conversation), false);
});

test("test_tools_mode_matches_only_tool_call_nodes", () => {
    // Scenario: "Tools" keeps both tool-call flavors and hides turns and commits.
    assert.equal(isNodeInFilterMode(plainToolCall, TIMELINE_FILTER_MODES.tools), true);
    assert.equal(isNodeInFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.tools), true);
    assert.equal(isNodeInFilterMode(userTurn, TIMELINE_FILTER_MODES.tools), false);
    assert.equal(isNodeInFilterMode(agentTurn, TIMELINE_FILTER_MODES.tools), false);
    assert.equal(isNodeInFilterMode(commit, TIMELINE_FILTER_MODES.tools), false);
});

test("test_scripts_mode_matches_tool_call_with_script_run", () => {
    // Scenario: "Scripts" keeps tool-call rows that ran a script, file-modifying or not.
    assert.equal(isNodeInFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.scripts), true);
    assert.equal(isNodeInFilterMode(readOnlyScriptToolCall, TIMELINE_FILTER_MODES.scripts), true);
});

test("test_scripts_mode_matches_agent_turn_with_script_execution_file_change", () => {
    // Scenario: "Scripts" keeps agent turns with a script-made revision, like the "Script" pill.
    assert.equal(isNodeInFilterMode(agentTurnWithScriptChange, TIMELINE_FILTER_MODES.scripts), true);
});

test("test_scripts_mode_rejects_plain_tool_call_and_plain_agent_turn", () => {
    // Scenario: "Scripts" hides rows with no script involvement.
    assert.equal(isNodeInFilterMode(plainToolCall, TIMELINE_FILTER_MODES.scripts), false);
    assert.equal(isNodeInFilterMode(agentTurn, TIMELINE_FILTER_MODES.scripts), false);
    assert.equal(isNodeInFilterMode(agentTurnWithEditChange, TIMELINE_FILTER_MODES.scripts), false);
});
