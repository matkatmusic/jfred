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
    // Scenario: a multi-agent project's nodes form ONE strictly chronological timeline, however
    // the sessions interleave (user-confirmed ordering decision).
    // Steps:
    // build the turn timeline for s84's unified document.
    // assert node timestamps are non-decreasing across the whole array.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    assert.ok(nodes.length > 0);
    for (let i = 1; i < nodes.length; i += 1) {
        assert.ok(nodes[i]!.when >= nodes[i - 1]!.when);
    }
});

test("test_timeline_nodes_carry_session_ids", () => {
    // Scenario: each turn node is attributed to the session whose message produced it.
    // Steps:
    // build s84's turn timeline; collect distinct sessionIds across agent turns.
    // assert at least 2 sessions appear (multi-agent scenario).
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const agentNodes = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    const distinct = new Set(
        agentNodes.map((node: { sessionId?: string }) => node.sessionId).filter((id: string | undefined) => id !== undefined),
    );
    assert.ok(distinct.size >= 2);
});

test("test_s40_agent_turns_are_all_attributed_to_a_session", () => {
    // Scenario: every agent-turn node in the s40 timeline names the session whose
    // records produced it — no user-edit evidence step collapses into an
    // unattributed (sessionId === undefined) synthetic turn.
    // Steps:
    // build the turn timeline for s40's unified (two-session) document.
    const { nodes } = buildTurnTimelineViewModel(s40Document);
    // collect the agent-turn nodes.
    const agentTurns = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    // assert none of them has an undefined sessionId.
    const unattributed = agentTurns.filter((node: { sessionId?: string }) => node.sessionId === undefined);
    assert.equal(unattributed.length, 0);
});

test("test_s40_each_session_key_forms_one_contiguous_run", () => {
    // Scenario: the s40 timeline lays each session out as ONE contiguous run of
    // nodes, so the render emits each session header exactly once and the rail
    // spine is unbroken. Walking nodes in order, the sequence of sessionId keys
    // (an undefined key counts as its own key, exactly as the header/rail render
    // keys off it) must have as many contiguous runs as there are distinct keys.
    // Steps:
    // build the turn timeline for s40's unified document.
    const { nodes } = buildTurnTimelineViewModel(s40Document);
    // reduce the node order to its sequence of session keys, then count contiguous
    // runs (a run boundary is where the key changes from the previous node).
    const sessionKeys = nodes.map((node: { sessionId?: string }) => node.sessionId ?? "undefined");
    let contiguousRuns = 0;
    let previousKey: string | undefined;
    for (const key of sessionKeys) {
        if (key !== previousKey) {
            contiguousRuns += 1;
            previousKey = key;
        }
    }
    // assert the number of runs equals the number of distinct keys (each key
    // appears in exactly one run — none is split by another).
    const distinctKeyCount = new Set(sessionKeys).size;
    assert.equal(contiguousRuns, distinctKeyCount);
});

test("test_timeline_includes_commit_nodes", () => {
    // Scenario: git commits appear as their own nodes, positioned after every step whose
    // timestamp precedes them (they become pick hard-stops in 3.2).
    // Steps:
    // build s85's turn timeline; assert at least one commit node exists.
    // for the first commit node, assert every earlier node's timestamp is <= its own.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const commitIndex = nodes.findIndex((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.ok(commitIndex >= 0);
    for (let i = 0; i < commitIndex; i += 1) {
        assert.ok(nodes[i]!.when <= nodes[commitIndex]!.when);
    }
});

// ─── turn-based timeline (plan phase A1): one node per conversation turn ────────────────────────

test("test_turn_timeline_has_one_node_per_message_plus_session_ends", () => {
    // Scenario: a timeline step is a conversation turn — every user prompt and every agent reply
    // becomes exactly one turn node, and every session gains one closing session-end node
    // (user decision 2026-07-06). Commit nodes AND the item-55 un-bubbled tool-call rows stay
    // separate and unnumbered.
    // Steps:
    // build s2's turn timeline.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    // collect the turn/session-end nodes (commit and tool-call rows are not turns).
    // item 55: const turnNodes = nodes.filter((node: { kind: string }) => node.kind !== COMMIT_NODE_KIND);
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
    // Scenario: step numbers run 1..N continuously across interleaved sessions (numbering never
    // restarts per session); commit nodes carry no step number.
    // Steps:
    // build s84's turn timeline (multi-session scenario).
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

test("test_agent_turn_owns_snapshots_between_prompts", () => {
    // Scenario: a StepSnapshot belongs to the FIRST agent reply of its own session at or after
    // it — tool calls execute before the reply's text is emitted (user-approved attribution rule).
    // Steps:
    // build s2's turn timeline.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const agentNodes = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    // for every snapshot: exactly one agent-turn node owns it.
    for (const step of s2Document.steps) {
        const owners = agentNodes.filter((node) =>
            node.snapshots!.some((snapshot: { index: number }) => snapshot.index === step.index));
        assert.equal(owners.length, 1);
        // the owner is in the snapshot's own session, at or after the snapshot.
        assert.equal(owners[0]!.sessionId, step.sessionId);
        assert.ok(owners[0]!.when >= step.when);
    }
});

test("test_agent_turn_carries_no_snapshot_of_other_sessions", () => {
    // Scenario: attribution never crosses sessions — an agent turn owns only snapshots produced
    // by its own session's tool calls, however the sessions interleave.
    // Steps:
    // build s84's turn timeline (multi-session scenario).
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    // assert every owned snapshot's sessionId equals its node's sessionId.
    for (const node of nodes.filter((entry: { kind: string }) => entry.kind === AGENT_TURN_NODE_KIND)) {
        for (const snapshot of node.snapshots!) {
            assert.equal(snapshot.sessionId, node.sessionId);
        }
    }
});
