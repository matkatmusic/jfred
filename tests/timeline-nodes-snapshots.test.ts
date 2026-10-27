// buildTurnTimelineViewModel: snapshot ownership by agent turns — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND } from "../webapp/views/timeline-types.ts";
import {
    s84Document,
    s2Document,
} from "./timeline-test-helpers.ts";

test("test_agent_turn_owns_snapshots_between_prompts", () => {
    // Scenario: each snapshot belongs to the first agent reply of its own session at or after it.
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
    // Scenario: an agent turn never owns a snapshot from another session.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    // assert every owned snapshot's sessionId equals its node's sessionId.
    for (const node of nodes.filter((entry: { kind: string }) => entry.kind === AGENT_TURN_NODE_KIND)) {
        for (const snapshot of node.snapshots!) {
            assert.equal(snapshot.sessionId, node.sessionId);
        }
    }
});
