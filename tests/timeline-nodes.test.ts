// buildTurnTimelineViewModel: node order, session attribution, numbering, snapshot ownership — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { S40_JSONL_PATHS } from "./fixtures.ts";
import {
    s84Document,
    s85Document,
    s2Document,
} from "./timeline-test-helpers.ts";

const s40Document = JSON.parse(JSON.stringify(buildProjectDocument(S40_JSONL_PATHS, undefined)));

test("test_timeline_nodes_are_chronological_across_sessions", () => {
    // Scenario: s84 nodes form one chronological timeline, with non-decreasing timestamps.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    assert.ok(nodes.length > 0);
    for (let i = 1; i < nodes.length; i += 1) {
        assert.ok(nodes[i]!.when >= nodes[i - 1]!.when);
    }
});

test("test_timeline_nodes_carry_session_ids", () => {
    // Scenario: each turn node carries its session id, and s84 shows at least 2 sessions.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const agentNodes = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    const distinct = new Set(
        agentNodes.map((node: { sessionId?: string }) => node.sessionId).filter((id: string | undefined) => id !== undefined),
    );
    assert.ok(distinct.size >= 2);
});

test("test_s40_agent_turns_are_all_attributed_to_a_session", () => {
    // Scenario: every s40 agent-turn node names its session; none has an undefined sessionId.
    const { nodes } = buildTurnTimelineViewModel(s40Document);
    // collect the agent-turn nodes.
    const agentTurns = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    // assert none of them has an undefined sessionId.
    const unattributed = agentTurns.filter((node: { sessionId?: string }) => node.sessionId === undefined);
    assert.equal(unattributed.length, 0);
});

test("test_s40_each_session_key_forms_one_contiguous_run", () => {
    // Scenario: the s40 timeline lays out each session as one contiguous run of nodes.
    const { nodes } = buildTurnTimelineViewModel(s40Document);
    // Count contiguous runs of session keys; a run ends where the key changes.
    const sessionKeys = nodes.map((node: { sessionId?: string }) => node.sessionId ?? "undefined");
    let contiguousRuns = 0;
    let previousKey: string | undefined;
    for (const key of sessionKeys) {
        if (key !== previousKey) {
            contiguousRuns += 1;
            previousKey = key;
        }
    }
    // Assert the run count equals the distinct key count.
    const distinctKeyCount = new Set(sessionKeys).size;
    assert.equal(contiguousRuns, distinctKeyCount);
});

test("test_timeline_includes_commit_nodes", () => {
    // Scenario: s85 has commit nodes, and every node before the first commit is not later than it.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const commitIndex = nodes.findIndex((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.ok(commitIndex >= 0);
    for (let i = 0; i < commitIndex; i += 1) {
        assert.ok(nodes[i]!.when <= nodes[commitIndex]!.when);
    }
});

// ─── turn-based timeline (plan phase A1): one node per conversation turn ────────────────────────

test("test_turn_timeline_has_one_node_per_message_plus_session_ends", () => {
    // Scenario: each prompt and reply is one turn node, and each session gains one session-end node.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    // Collect turn and session-end nodes; commit and tool-call rows are not turns (item 55).
    const turnNodes = nodes.filter(
        (node: { kind: string }) => node.kind !== COMMIT_NODE_KIND && node.kind !== TOOL_CALL_NODE_KIND,
    );
    // count s2's distinct sessions.
    const distinctSessions = new Set(s2Document.messages.map((message: { sessionId: string }) => message.sessionId));
    // assert one node per message plus one session-end per session (s2 needs no synthetic turns).
    assert.equal(turnNodes.length, s2Document.messages.length + distinctSessions.size);
    // assert every message yields a node of the matching kind carrying its text.
    for (const message of s2Document.messages) {
        const expectedKind = message.role === RecordType.user ? USER_TURN_NODE_KIND : AGENT_TURN_NODE_KIND;
        const owner = turnNodes.find((node: { uuid?: string }) => node.uuid === message.uuid);
        assert.ok(owner !== undefined);
        assert.equal(owner.kind, expectedKind);
        assert.equal(owner.text, message.text);
    }
    // assert the whole node array is chronological.
    for (let i = 1; i < nodes.length; i += 1) {
        assert.ok(nodes[i]!.when >= nodes[i - 1]!.when);
    }
});

test("test_turn_timeline_numbers_steps_continuously_across_sessions", () => {
    // Scenario: step numbers run 1..N across sessions, and commit nodes carry none.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    // collect stepNumber over every numbered node kind, in node order.
    const numberedKinds = new Set([USER_TURN_NODE_KIND, AGENT_TURN_NODE_KIND, SESSION_END_NODE_KIND]);
    const stepNumbers = nodes
        .filter((node: { kind: string }) => numberedKinds.has(node.kind))
        .map((node: { stepNumber?: number }) => node.stepNumber);
    assert.ok(stepNumbers.length > 0);
    // assert they are exactly 1..N with no gaps.
    stepNumbers.forEach((stepNumber: number | undefined, position: number) => assert.equal(stepNumber, position + 1));
    // assert commit nodes are unnumbered.
    for (const node of nodes.filter((entry: { kind: string }) => entry.kind === COMMIT_NODE_KIND)) {
        assert.equal(node.stepNumber, undefined);
    }
});
