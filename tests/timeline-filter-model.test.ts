// Timeline event-type filter predicate (timeline-filter-model.ts, task 114) — literal-node
// fixtures; one behavior per test, per the truth table in plans/task114-timeline-filter-buttons-plan.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TIMELINE_FILTER_MODES,
    TIMELINE_FILTER_BUTTONS,
    checkNodeMatchesFilterMode,
} from "../webapp/views/timeline-filter-model.ts";
import { SCRIPT_EXECUTION_EVENT_KIND } from "../webapp/views/timeline-labels.ts";
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

// ── fixture nodes: one minimal literal per shape the predicate distinguishes ────────────────────
const userTurn: TurnNode = { kind: USER_TURN_NODE_KIND, when: "t1", sessionId: "s", text: "hi", snapshots: [], gitOperations: [] };
const agentTurn: TurnNode = { kind: AGENT_TURN_NODE_KIND, when: "t2", sessionId: "s", text: "ok", snapshots: [], gitOperations: [] };
const agentTurnWithScriptChange: TurnNode = { ...agentTurn, fileChanges: [{ path: "a.py", eventKind: SCRIPT_EXECUTION_EVENT_KIND, renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: "t2" }] };
const agentTurnWithEditChange: TurnNode = { ...agentTurn, fileChanges: [{ path: "a.py", eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "t2" }] };
const sessionEnd: SessionEndNode = { kind: SESSION_END_NODE_KIND, when: "t9", sessionId: "s", snapshots: [] };
const commit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t3", sessionId: "s" };
const plainToolCall: ToolCallNode = { kind: TOOL_CALL_NODE_KIND, when: "t4", sessionId: "s", uuid: "u1", toolName: "Grep", summary: "grep foo", toolUseId: "tu1" };
const scriptToolCall: ToolCallNode = { ...plainToolCall, uuid: "u2", toolUseId: "tu2", scriptRun: { timestamp: "t4", code: "print()", changedPaths: ["a.py"] } };
const readOnlyScriptToolCall: ToolCallNode = { ...plainToolCall, uuid: "u3", toolUseId: "tu3", scriptRun: { timestamp: "t4", code: "print()", changedPaths: [] } };
const EVERY_FIXTURE_NODE: TimelineNode[] = [userTurn, agentTurn, agentTurnWithScriptChange, agentTurnWithEditChange, sessionEnd, commit, plainToolCall, scriptToolCall, readOnlyScriptToolCall];

test("test_all_mode_matches_every_node_kind", () => {
    // Scenario: "All" is the default mode and hides nothing.
    // Steps: run the predicate over every fixture shape; each must match.
    for (const node of EVERY_FIXTURE_NODE) {
        assert.equal(checkNodeMatchesFilterMode(node, TIMELINE_FILTER_MODES.all), true);
    }
});

test("test_conversation_mode_matches_user_and_agent_turns", () => {
    // Scenario: "Conversation" keeps the message rows — user prompts and agent replies.
    // Steps: a user turn matches; an agent turn matches.
    assert.equal(checkNodeMatchesFilterMode(userTurn, TIMELINE_FILTER_MODES.conversation), true);
    assert.equal(checkNodeMatchesFilterMode(agentTurn, TIMELINE_FILTER_MODES.conversation), true);
});

test("test_conversation_mode_rejects_tool_call_and_commit_nodes", () => {
    // Scenario: "Conversation" hides non-message rows.
    // Steps: a tool-call row is hidden; a commit row is hidden.
    assert.equal(checkNodeMatchesFilterMode(plainToolCall, TIMELINE_FILTER_MODES.conversation), false);
    assert.equal(checkNodeMatchesFilterMode(commit, TIMELINE_FILTER_MODES.conversation), false);
});

test("test_tools_mode_matches_only_tool_call_nodes", () => {
    // Scenario: "Tools" keeps tool-call rows (each row carries its call AND its result summary).
    // Steps: both tool-call flavors match; turns and commits are hidden.
    assert.equal(checkNodeMatchesFilterMode(plainToolCall, TIMELINE_FILTER_MODES.tools), true);
    assert.equal(checkNodeMatchesFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.tools), true);
    assert.equal(checkNodeMatchesFilterMode(userTurn, TIMELINE_FILTER_MODES.tools), false);
    assert.equal(checkNodeMatchesFilterMode(agentTurn, TIMELINE_FILTER_MODES.tools), false);
    assert.equal(checkNodeMatchesFilterMode(commit, TIMELINE_FILTER_MODES.tools), false);
});

test("test_scripts_mode_matches_tool_call_with_script_run", () => {
    // Scenario: "Scripts" keeps tool-call rows that executed a script, file-modifying or not.
    // Steps: a script run with changed files matches; a read-only script run matches too.
    assert.equal(checkNodeMatchesFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.scripts), true);
    assert.equal(checkNodeMatchesFilterMode(readOnlyScriptToolCall, TIMELINE_FILTER_MODES.scripts), true);
});

test("test_scripts_mode_matches_agent_turn_with_script_execution_file_change", () => {
    // Scenario: "Scripts" keeps agent turns whose file chips carry a script-made revision —
    // the exact rule the "Script" role pill uses (computeRolePillLabel).
    // Steps: an agent turn with a script-execution file change matches.
    assert.equal(checkNodeMatchesFilterMode(agentTurnWithScriptChange, TIMELINE_FILTER_MODES.scripts), true);
});

test("test_scripts_mode_rejects_plain_tool_call_and_plain_agent_turn", () => {
    // Scenario: "Scripts" hides rows with no script involvement.
    // Steps: a scriptless tool call is hidden; a plain agent turn is hidden; an agent turn whose
    // only file change is a hand edit is hidden.
    assert.equal(checkNodeMatchesFilterMode(plainToolCall, TIMELINE_FILTER_MODES.scripts), false);
    assert.equal(checkNodeMatchesFilterMode(agentTurn, TIMELINE_FILTER_MODES.scripts), false);
    assert.equal(checkNodeMatchesFilterMode(agentTurnWithEditChange, TIMELINE_FILTER_MODES.scripts), false);
});

test("test_files_mode_matches_node_with_file_changes", () => {
    // Scenario: "Files" keeps rows carrying file-change chips, whatever made the change.
    // Steps: an agent turn with an edit chip matches; one with a script-made chip matches.
    assert.equal(checkNodeMatchesFilterMode(agentTurnWithEditChange, TIMELINE_FILTER_MODES.files), true);
    assert.equal(checkNodeMatchesFilterMode(agentTurnWithScriptChange, TIMELINE_FILTER_MODES.files), true);
});

test("test_files_mode_matches_tool_call_whose_script_run_changed_files", () => {
    // Scenario: "Files" keeps script-run rows only when the sandbox proved files changed
    // (scriptRun.changedPaths is [] on read-only/declined runs).
    // Steps: a file-modifying script run matches; a read-only script run is hidden.
    assert.equal(checkNodeMatchesFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.files), true);
    assert.equal(checkNodeMatchesFilterMode(readOnlyScriptToolCall, TIMELINE_FILTER_MODES.files), false);
});

test("test_files_mode_rejects_nodes_without_file_changes", () => {
    // Scenario: "Files" hides rows that touched no files.
    // Steps: chipless turns, a plain tool call, and a commit are all hidden.
    assert.equal(checkNodeMatchesFilterMode(userTurn, TIMELINE_FILTER_MODES.files), false);
    assert.equal(checkNodeMatchesFilterMode(agentTurn, TIMELINE_FILTER_MODES.files), false);
    assert.equal(checkNodeMatchesFilterMode(plainToolCall, TIMELINE_FILTER_MODES.files), false);
    assert.equal(checkNodeMatchesFilterMode(commit, TIMELINE_FILTER_MODES.files), false);
});

test("test_git_mode_matches_only_commit_nodes", () => {
    // Scenario: "Git" keeps the commit hard-stop rows and nothing else.
    // Steps: a commit matches; turns and tool calls (script or not) are hidden.
    assert.equal(checkNodeMatchesFilterMode(commit, TIMELINE_FILTER_MODES.git), true);
    assert.equal(checkNodeMatchesFilterMode(userTurn, TIMELINE_FILTER_MODES.git), false);
    assert.equal(checkNodeMatchesFilterMode(plainToolCall, TIMELINE_FILTER_MODES.git), false);
    assert.equal(checkNodeMatchesFilterMode(scriptToolCall, TIMELINE_FILTER_MODES.git), false);
});

test("test_session_end_matches_every_mode", () => {
    // Scenario: session-end terminators anchor each session's extent, so no mode may hide them.
    // Steps: the session-end fixture matches all six modes.
    for (const mode of Object.values(TIMELINE_FILTER_MODES)) {
        assert.equal(checkNodeMatchesFilterMode(sessionEnd, mode), true);
    }
});

test("test_filter_buttons_cover_every_mode_with_all_first", () => {
    // Scenario: the button list drives the rendered bar — it must cover every mode exactly once,
    // "All" first (it is the default).
    // Steps: project the ordered mode column and compare against the canonical order.
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
