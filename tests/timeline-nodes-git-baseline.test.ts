// buildTurnTimelineViewModel: git-derived baseline rows — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { RecordType, EventKind, GitOperationKind } from "../src/structures/vocabulary.ts";
import { gitBaselineDocument } from "./timeline-test-helpers.ts";

// A MID-timeline baseline (task 56): one prompt/reply pair BEFORE the gitBase step, one generic step after it — the shape where declining pre-baseline reconstruction visibly changes what the timeline shows.
const midBaselineDocument = {
    messages: [{
        uuid: "prompt-1",
        role: RecordType.user,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:00.000Z",
        text: "early work",
    }, {
        uuid: "reply-1",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:10.000Z",
        text: "did early work",
    }],
    steps: [
        { index: 1, when: "2026-01-01T00:00:30.000Z", sessionId: undefined, changeIds: ["gitBase:abc1234:orders.py"], changedPaths: [], files: {} },
        { index: 2, when: "2026-01-01T00:00:40.000Z", sessionId: undefined, changeIds: ["deadbeef00000000@v1"], changedPaths: ["notes.txt"], files: {} },
    ],
    filesTouched: [{
        target: "orders.py",
        revisions: [{ kind: EventKind.write, changeId: "gitBase:abc1234:orders.py", timestamp: "2026-01-01T00:00:30.000Z" }],
    }],
    rewoundFilesTouched: [],
    commitMarkers: [],
    gitOperations: [],
};

test("test_buildTurnTimelineViewModel_routes_gitBase_only_step_to_baseline_node", () => {
    // Scenario: a step whose every changeId is a gitBase: beacon becomes its own agent-turn node flagged isGitBaseline, carrying the baseline file chips (task 86).  Steps: build the timeline from the git-baseline document.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    // find the baseline node and assert it exists exactly once.
    const baselineNodes = nodes.filter((node) => node.isGitBaseline === true);
    assert.equal(baselineNodes.length, 1);
    // assert it is an agent turn (a regular message row) carrying the baseline file chip.
    assert.equal(baselineNodes[0]!.kind, AGENT_TURN_NODE_KIND);
    assert.deepEqual(baselineNodes[0]!.fileChanges!.map((change) => change.path), ["orders.py"]);
});

test("test_buildTurnTimelineViewModel_names_base_commit_in_baseline_node_text", () => {
    // Scenario: the baseline node's message text names the base commit hash extracted from the gitBase:<hash>:<target> changeId, so the row summary reads meaningfully.  Steps: build the timeline and find the baseline node.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    const baselineNode = nodes.find((node) => node.isGitBaseline === true);
    // assert its text mentions the hash.
    assert.ok(baselineNode!.text!.includes("abc1234"));
});

test("test_timeline_drops_nodes_before_baseline_node_when_pre_baseline_skipped", () => {
    // Scenario (task 56): the document was built with pre-baseline reconstruction declined — the git-baseline node is the FIRST shown step; everything earlier is hidden.  Steps: build the timeline from the mid-baseline document with the wire flag set.
    const { nodes } = buildTurnTimelineViewModel({ ...midBaselineDocument, preBaselineSkipped: true });
    // assert the first node IS the baseline node.
    assert.equal(nodes[0]!.isGitBaseline, true);
    // assert no surviving node precedes the baseline node's instant.
    const baselineWhen = nodes[0]!.when;
    assert.ok(nodes.every((node) => node.when >= baselineWhen));
    // assert the pre-baseline prompt is gone while the post-baseline step's turn survives.
    assert.equal(nodes.find((node) => node.text === "early work"), undefined);
    assert.ok(nodes.some((node) => (node.fileChanges ?? []).some((change) => change.path === "notes.txt")));
});

test("test_timeline_keeps_all_nodes_when_pre_baseline_flag_absent", () => {
    // Scenario (task 56): the same document WITHOUT the flag renders every node — the filter must never fire on ordinary builds.  Steps: build the timeline from the mid-baseline document as-is.
    const { nodes } = buildTurnTimelineViewModel(midBaselineDocument);
    // assert the pre-baseline prompt is still shown.
    assert.ok(nodes.some((node) => node.text === "early work"));
    // assert the baseline node is still present (later in the stream).
    assert.ok(nodes.some((node) => node.isGitBaseline === true));
});

// task 121: the same baseline shape, but the session RECORDED the base commit — one commit whose short resultHash prefixes the full gitBase hash (the merge host) and one control commit that must keep the plain commit dress.
const BASELINE_FULL_HASH = "14e26eced65bfc384a65a533e87a0da11221726c";
const recordedBaseCommitDocument = {
    messages: [{
        uuid: "prompt-1",
        role: RecordType.user,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:10:00.000Z",
        text: "start working",
    }],
    steps: [
        { index: 1, when: "2026-01-01T00:00:00.000Z", sessionId: undefined, changeIds: [`gitBase:${BASELINE_FULL_HASH}:orders.py`], changedPaths: [], files: {} },
    ],
    filesTouched: [{
        target: "orders.py",
        revisions: [{ kind: EventKind.write, changeId: `gitBase:${BASELINE_FULL_HASH}:orders.py`, timestamp: "2026-01-01T00:00:00.000Z" }],
    }],
    rewoundFilesTouched: [],
    commitMarkers: [],
    gitOperations: [{
        kind: GitOperationKind.commit,
        detail: "baseline",
        command: 'git commit -m "baseline"',
        timestamp: "2026-01-01T00:05:00.000Z",
        sessionId: "session-a",
        resultHash: "14e26ec",
    }, {
        kind: GitOperationKind.commit,
        detail: "later work",
        command: 'git commit -m "later work"',
        timestamp: "2026-01-01T00:20:00.000Z",
        sessionId: "session-a",
        resultHash: "fffffff",
    }],
};

test("test_buildTurnTimelineViewModel_merges_baseline_into_recorded_base_commit_row", () => {
    // Scenario (task 121): the session recorded the base commit, so the baseline turn is absorbed into that commit's row — ONE commit-kind node carrying the baseline flag, text, and file chips; no separate agent-turn baseline node exists.  Steps: build the timeline from the recorded-base-commit document.
    const { nodes } = buildTurnTimelineViewModel(recordedBaseCommitDocument);
    // assert exactly one node carries the baseline flag.
    const baselineNodes = nodes.filter((node) => node.isGitBaseline === true);
    assert.equal(baselineNodes.length, 1);
    // assert the flagged node IS the recorded base-commit row (commit kind, matching short hash).
    assert.equal(baselineNodes[0]!.kind, COMMIT_NODE_KIND);
    assert.equal(baselineNodes[0]!.resultHash, "14e26ec");
    // assert it carries the seeded file chip.
    assert.deepEqual(baselineNodes[0]!.fileChanges!.map((change) => change.path), ["orders.py"]);
    // assert its summary text names the full base commit hash.
    assert.ok(baselineNodes[0]!.text!.includes(BASELINE_FULL_HASH));
    // assert no agent-turn baseline node was created alongside the merged row.
    assert.equal(nodes.find((node) => node.kind === AGENT_TURN_NODE_KIND && node.isGitBaseline === true), undefined);
});

test("test_buildTurnTimelineViewModel_keeps_other_commit_rows_plain", () => {
    // Scenario (task 121): only the base-commit row wears the baseline dress — every other commit keeps the plain commit row (no flag, no chips).  Steps: build the timeline from the recorded-base-commit document.
    const { nodes } = buildTurnTimelineViewModel(recordedBaseCommitDocument);
    // find the control commit by its non-matching hash.
    const controlCommitNode = nodes.find((node) => node.resultHash === "fffffff");
    assert.ok(controlCommitNode !== undefined);
    // assert it is not flagged and carries no chips.
    assert.notEqual(controlCommitNode!.isGitBaseline, true);
    assert.equal(controlCommitNode!.fileChanges, undefined);
});

test("test_buildTurnTimelineViewModel_keeps_standalone_baseline_when_no_commit_matches", () => {
    // Scenario (task 121 fallback): the session never recorded the base commit (e.g. a back-dated commit) — the standalone green baseline agent-turn must survive.  Steps: build the timeline with only the non-matching control commit recorded.
    const unrecordedDocument = { ...recordedBaseCommitDocument, gitOperations: [recordedBaseCommitDocument.gitOperations[1]!] };
    const { nodes } = buildTurnTimelineViewModel(unrecordedDocument);
    // assert the single baseline node is the standalone agent turn.
    const baselineNodes = nodes.filter((node) => node.isGitBaseline === true);
    assert.equal(baselineNodes.length, 1);
    assert.equal(baselineNodes[0]!.kind, AGENT_TURN_NODE_KIND);
    // assert the control commit stays plain.
    assert.notEqual(nodes.find((node) => node.resultHash === "fffffff")!.isGitBaseline, true);
});

test("test_timeline_drops_nodes_before_merged_baseline_row_when_pre_baseline_skipped", () => {
    // Scenario (task 121 × task 56): pre-baseline reconstruction was declined AND the baseline merged into its commit row — the task-56 filter keys on the flag, not the node kind, so the merged COMMIT row is the timeline's first shown node.  Steps: build the timeline with the wire flag set.
    const { nodes } = buildTurnTimelineViewModel({ ...recordedBaseCommitDocument, preBaselineSkipped: true });
    // assert the first node is the merged baseline commit row.
    assert.equal(nodes[0]!.isGitBaseline, true);
    assert.equal(nodes[0]!.kind, COMMIT_NODE_KIND);
});

test("test_buildTurnTimelineViewModel_keeps_generic_unattributed_step_out_of_baseline_node", () => {
    // Scenario: a generic unattributed step (non-gitBase changeIds) still collects into the plain synthetic turn — it must NOT merge into the baseline node.  Steps: build the timeline from the git-baseline document.
    const { nodes } = buildTurnTimelineViewModel(gitBaselineDocument);
    // find the plain synthetic turn by its notes.txt fallback chip.
    const genericNode = nodes.find((node) => (node.fileChanges ?? []).some((change) => change.path === "notes.txt"));
    // assert it exists and is not flagged as baseline.
    assert.ok(genericNode !== undefined);
    assert.notEqual(genericNode!.isGitBaseline, true);
});
