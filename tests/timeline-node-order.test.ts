// Unit tests for timeline node ordering, numbering, and pre-baseline trimming.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareTimelineNodes, filterPreBaselineNodes, setStepNumbers } from "../webapp/views/timeline-node-order.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { TimelineNode } from "../webapp/views/timeline-node-types.ts";

const turn = (when: string, isGitBaseline?: boolean): TimelineNode => ({ kind: AGENT_TURN_NODE_KIND, when, sessionId: "s1", text: "", snapshots: [], gitOperations: [], isGitBaseline });
const commit = (when: string): TimelineNode => ({ kind: COMMIT_NODE_KIND, when, sessionId: "s1" });

test("compareTimelineNodes orders by time then kind rank", () => {
    const sorted = [commit("1"), turn("1"), turn("0")].sort(compareTimelineNodes);
    assert.deepEqual(sorted.map((node) => node.kind + node.when), ["agent-turn0", "agent-turn1", "commit1"]);
});

test("setStepNumbers skips commit nodes", () => {
    const nodes = [turn("1"), commit("2"), turn("3")];
    setStepNumbers(nodes);
    assert.deepEqual(nodes.map((node) => node.stepNumber), [1, undefined, 2]);
});

test("filterPreBaselineNodes drops nodes before the baseline only when skipped", () => {
    const nodes = [turn("1"), turn("2", true), turn("3")];
    assert.equal(filterPreBaselineNodes(nodes, true).length, 2);
    assert.equal(filterPreBaselineNodes(nodes, false).length, 3);
    assert.equal(filterPreBaselineNodes([turn("1")], true).length, 1);
});
