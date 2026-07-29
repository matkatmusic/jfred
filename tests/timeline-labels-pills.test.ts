// role pills and session-start labels (timeline-labels.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeRolePillClass,
    computeRolePillLabel,
    computeSessionStartLabel,
    findSessionStartIndexes,
} from "../webapp/views/timeline-labels.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    s39SeedDocument,
    gitBaselineDocument,
} from "./timeline-test-helpers.ts";

test("test_computeRolePillLabel_names_each_row_kind", () => {
    // Scenario: timeline rows open with a pill-style role tag — "User" on user turns,
    // "Agent" on agent turns, "Tool" on tool-call rows; commit and session-end rows
    // carry no pill (their row text already names what they are).
    // Steps:
    // build the timeline nodes from the s39 wire document.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    // a user turn labels "User".
    const userTurn = nodes.find((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND)!;
    assert.equal(computeRolePillLabel(userTurn), "User");
    // an agent turn labels "Agent".
    const agentTurn = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)!;
    assert.equal(computeRolePillLabel(agentTurn), "Agent");
    // a tool-call row labels "Tool".
    const toolCall = nodes.find((node: { kind: string }) => node.kind === TOOL_CALL_NODE_KIND)!;
    assert.equal(computeRolePillLabel(toolCall), "Tool");
    // a session-end row gets no pill.
    const sessionEnd = nodes.find((node: { kind: string }) => node.kind === SESSION_END_NODE_KIND)!;
    assert.equal(computeRolePillLabel(sessionEnd), undefined);
});

test("test_computeRolePillLabel_marks_script_running_turns_as_script", () => {
    // Scenario: an agent turn whose file chips include a script-made revision IS the script run's row — its pill reads "Script" instead of "Agent".  Steps: build an agent turn carrying one script-execution file change.
    const scriptTurn = {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-01-01T00:00:00Z",
        sessionId: "s",
        text: "",
        snapshots: [],
        gitOperations: [],
        fileChanges: [{ path: "/tmp/a.py", eventKind: "script-execution", renamedFrom: undefined, isFirstRevision: false, changeId: "scriptRun:x:/tmp/a.py", when: "2026-01-01T00:00:00Z" }],
    };
    // the pill labels the turn "Script".
    assert.equal(computeRolePillLabel(scriptTurn as never), "Script");
    // the same turn with a plain edit chip stays "Agent".
    const editTurn = { ...scriptTurn, fileChanges: [{ ...scriptTurn.fileChanges[0]!, eventKind: "edit" }] };
    assert.equal(computeRolePillLabel(editTurn as never), "Agent");
});

test("test_findSessionStartIndexes_marks_each_sessions_first_node_once", () => {
    // Scenario: an interleaved multi-session timeline shows a start marker where each session's FIRST row sits — one marker per session, none at later interleave switches back to an already-started session.  Steps: build a 4-node interleave: session A, session B, back to A, back to B.
    const nodes = [
        { kind: USER_TURN_NODE_KIND, when: "2026-01-01T00:00:01Z", sessionId: "aaaa1111-0000-4000-8000-000000000001", text: "a1", snapshots: [], gitOperations: [] },
        { kind: USER_TURN_NODE_KIND, when: "2026-01-01T00:00:02Z", sessionId: "bbbb2222-0000-4000-8000-000000000002", text: "b1", snapshots: [], gitOperations: [] },
        { kind: USER_TURN_NODE_KIND, when: "2026-01-01T00:00:03Z", sessionId: "aaaa1111-0000-4000-8000-000000000001", text: "a2", snapshots: [], gitOperations: [] },
        { kind: USER_TURN_NODE_KIND, when: "2026-01-01T00:00:04Z", sessionId: "bbbb2222-0000-4000-8000-000000000002", text: "b2", snapshots: [], gitOperations: [] },
    ];
    const starts = findSessionStartIndexes(nodes as never);
    // exactly two markers: node 0 starts session A, node 1 starts session B.
    assert.deepEqual(starts, [
        { nodeIndex: 0, sessionId: "aaaa1111-0000-4000-8000-000000000001" },
        { nodeIndex: 1, sessionId: "bbbb2222-0000-4000-8000-000000000002" },
    ]);
});

test("test_findSessionStartIndexes_skips_unattributed_nodes", () => {
    // Scenario: nodes with no sessionId (unattributed steps) never produce a start marker.  Steps: build one unattributed node followed by one session node.
    const nodes = [
        { kind: AGENT_TURN_NODE_KIND, when: "2026-01-01T00:00:01Z", sessionId: undefined, text: "", snapshots: [], gitOperations: [] },
        { kind: USER_TURN_NODE_KIND, when: "2026-01-01T00:00:02Z", sessionId: "cccc3333-0000-4000-8000-000000000003", text: "c1", snapshots: [], gitOperations: [] },
    ];
    const starts = findSessionStartIndexes(nodes as never);
    // only the attributed node yields a marker.
    assert.deepEqual(starts, [{ nodeIndex: 1, sessionId: "cccc3333-0000-4000-8000-000000000003" }]);
});

test("test_computeSessionStartLabel_uses_custom_title_when_present", () => {
    // Scenario: session-start markers name the session with its user-given custom title — "Session <custom-title> started: <sessionId>" — falling back to "Session started: <sessionId>" when the session was never named.  Steps: a titles map naming one of two sessions.
    const sessionTitles = { "aaaa1111-0000-4000-8000-000000000001": "fork-style-mockup" };
    // the named session leads with its title.
    assert.equal(
        computeSessionStartLabel(sessionTitles, "aaaa1111-0000-4000-8000-000000000001"),
        "Session fork-style-mockup started: aaaa1111-0000-4000-8000-000000000001",
    );
    // the unnamed session falls back to id-only.
    assert.equal(
        computeSessionStartLabel(sessionTitles, "bbbb2222-0000-4000-8000-000000000002"),
        "Session started: bbbb2222-0000-4000-8000-000000000002",
    );
    // an absent titles map (older cached documents) also falls back.
    assert.equal(
        computeSessionStartLabel(undefined, "bbbb2222-0000-4000-8000-000000000002"),
        "Session started: bbbb2222-0000-4000-8000-000000000002",
    );
});

test("test_computeRolePillLabel_labels_git_baseline_turn", () => {
    // Scenario: the baseline node's role pill reads "git-derived baseline" instead of Agent (task 86 — the user-chosen tag).  Steps: build the timeline and find the baseline node.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    const baselineNode = nodes.find((node) => node.isGitBaseline === true);
    // assert the pill label.
    assert.equal(computeRolePillLabel(baselineNode!), "git-derived baseline");
});

test("test_computeRolePillClass_hyphenates_multiword_labels", () => {
    // Scenario: the pill's CSS class token hyphenates label spaces so "git-derived baseline" stays one class; single-word labels keep their existing class names.  Steps: assert the multi-word label hyphenates.
    assert.equal(computeRolePillClass("git-derived baseline"), "role-pill-git-derived-baseline");
    // assert a single-word label is unchanged from the old inline lowercasing.
    assert.equal(computeRolePillClass("User"), "role-pill-user");
});
