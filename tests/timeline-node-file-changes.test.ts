// Unit tests for stamping file chips onto timeline nodes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyNodeFileChanges } from "../webapp/views/timeline-node-file-changes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { RevisionIndex, TimelineNode } from "../webapp/views/timeline-node-types.ts";

const revisionIndex: RevisionIndex = new Map();
const snapshots = [{ index: 0, when: "1", changeIds: [], changedPaths: ["a.ts"] }];

test("applyNodeFileChanges stamps chips on snapshot-owning nodes only", () => {
    const turn: TimelineNode = { kind: AGENT_TURN_NODE_KIND, when: "1", sessionId: "s1", text: "", snapshots, gitOperations: [] };
    const commit: TimelineNode = { kind: COMMIT_NODE_KIND, when: "1", sessionId: "s1" };
    applyNodeFileChanges([turn, commit], revisionIndex);
    assert.deepEqual(turn.fileChanges!.map((change) => change.path), ["a.ts"]);
    assert.equal(commit.fileChanges, undefined);
});
