// buildTurnTimelineViewModel: git-derived baseline rows — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { gitBaselineDocument } from "./timeline-test-helpers.ts";

test("test_buildTurnTimelineViewModel_routes_gitBase_only_step_to_baseline_node", () => {
    // Scenario: a step whose every changeId is a gitBase: beacon becomes its own agent-turn node
    // flagged isGitBaseline, carrying the baseline file chips (task 86).
    // Steps:
    // build the timeline from the git-baseline document.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    // find the baseline node and assert it exists exactly once.
    const baselineNodes = nodes.filter((node) => node.isGitBaseline === true);
    assert.equal(baselineNodes.length, 1);
    // assert it is an agent turn (a regular message row) carrying the baseline file chip.
    assert.equal(baselineNodes[0]!.kind, AGENT_TURN_NODE_KIND);
    assert.deepEqual(baselineNodes[0]!.fileChanges!.map((change) => change.path), ["orders.py"]);
});

test("test_buildTurnTimelineViewModel_names_base_commit_in_baseline_node_text", () => {
    // Scenario: the baseline node's message text names the base commit hash extracted from the
    // gitBase:<hash>:<target> changeId, so the row summary reads meaningfully.
    // Steps:
    // build the timeline and find the baseline node.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    const baselineNode = nodes.find((node) => node.isGitBaseline === true);
    // assert its text mentions the hash.
    assert.ok(baselineNode!.text!.includes("abc1234"));
});

test("test_buildTurnTimelineViewModel_keeps_generic_unattributed_step_out_of_baseline_node", () => {
    // Scenario: a generic unattributed step (non-gitBase changeIds) still collects into the plain
    // synthetic turn — it must NOT merge into the baseline node.
    // Steps:
    // build the timeline from the git-baseline document.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    // find the plain synthetic turn by its notes.txt fallback chip.
    const genericNode = nodes.find((node) => (node.fileChanges ?? []).some((change) => change.path === "notes.txt"));
    // assert it exists and is not flagged as baseline.
    assert.ok(genericNode !== undefined);
    assert.notEqual(genericNode!.isGitBaseline, true);
});
