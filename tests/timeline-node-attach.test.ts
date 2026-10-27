// Unit tests for attaching step snapshots to agent turns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachSnapshotsToAgentTurns } from "../webapp/views/timeline-node-attach.ts";
import { AGENT_TURN_NODE_KIND, type TurnNode, type WireStepSnapshot } from "../webapp/views/timeline-types.ts";

const turn = (when: string): TurnNode => ({ kind: AGENT_TURN_NODE_KIND, when, sessionId: "s1", text: "", snapshots: [], gitOperations: [] });
const snapshot = (when: string): WireStepSnapshot => ({ index: 0, when, sessionId: "s1", changeIds: [], changedPaths: [] });

test("a snapshot attaches to the first same-session turn at or after it", () => {
    const turns = [turn("2"), turn("3")];
    attachSnapshotsToAgentTurns(turns, [], [snapshot("1")]);
    assert.equal(turns[0]!.snapshots.length, 1);
    assert.equal(turns[1]!.snapshots.length, 0);
});

test("ownerless snapshots share one synthetic turn per session", () => {
    const turns = [turn("1")];
    attachSnapshotsToAgentTurns(turns, [], [snapshot("5"), snapshot("6")]);
    assert.equal(turns.length, 2);
    assert.equal(turns[1]!.snapshots.length, 2);
    assert.equal(turns[1]!.when, "6");
});
