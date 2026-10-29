// addGitBaselineSnapshot: gitBase-only snapshots land on the base-commit row, else on one new baseline turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addGitBaselineSnapshot } from "../webapp/views/timeline-baseline-host.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { CommitNode, TurnNode } from "../webapp/views/timeline-node-types.ts";
import type { WireStepSnapshot } from "../webapp/views/timeline-wire-types.ts";

function createSnapshot(index: number): WireStepSnapshot {
    return { index, when: "2026-01-01T00:00:00.000Z", sessionId: "session-a", changeIds: ["gitBase:abc1234def"], changedPaths: ["a.ts"] };
}

test("test_a_snapshot_lands_on_the_commit_row_whose_short_hash_prefixes_the_base_commit", () => {
    const commit = { kind: COMMIT_NODE_KIND, resultHash: "abc1234", snapshots: [] } as unknown as CommitNode;
    const turnNodes: TurnNode[] = [];
    const first = createSnapshot(0);
    const host = addGitBaselineSnapshot(turnNodes, [commit], first, undefined);
    assert.equal(host, commit);
    assert.equal(commit.isGitBaseline, true);
    assert.deepEqual(commit.snapshots, [first]);
    assert.equal(turnNodes.length, 0);
});

test("test_with_no_matching_commit_one_baseline_turn_is_created_and_reused", () => {
    const otherCommit = { kind: COMMIT_NODE_KIND, resultHash: "", snapshots: [] } as unknown as CommitNode;
    const turnNodes: TurnNode[] = [];
    const first = createSnapshot(0);
    const second = createSnapshot(1);
    const host = addGitBaselineSnapshot(turnNodes, [otherCommit], first, undefined);
    const sameHost = addGitBaselineSnapshot(turnNodes, [otherCommit], second, host);
    assert.equal(sameHost, host);
    assert.equal(turnNodes.length, 1);
    assert.equal(turnNodes[0]!.kind, AGENT_TURN_NODE_KIND);
    assert.deepEqual(turnNodes[0]!.snapshots, [first, second]);
});
