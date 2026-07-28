// pick legality, segments, and range summaries (timeline-picks.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    checkPickIsLegal,
    checkSelectionBlocksBackgroundClose,
    computePickSegments,
    computeRangeSummary,
} from "../webapp/views/timeline-picks.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    s84Document,
    s85Document,
    s2Document,
    s45Document,
} from "./timeline-test-helpers.ts";

test("test_pick_crossing_commit_is_illegal", () => {
    // Scenario: git commit nodes are hard stops — a pick range can never cross one.  Steps: build s85's turn timeline; locate its first commit node.  pick the nearest pickable node on each side of it.  assert the pick is illegal (and that the commit node itself sits in no segment).
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    const commitIndex = nodes.findIndex((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.ok(commitIndex >= 0);
    assert.equal(segments[commitIndex], null);
    let before = -1;
    for (let index = commitIndex - 1; index >= 0; index -= 1) {
        if (segments[index] !== null) {
            before = index;
            break;
        }
    }
    const after = segments.findIndex(
        (segment: number | null, index: number) => index > commitIndex && segment !== null,
    );
    assert.ok(before >= 0);
    assert.ok(after > commitIndex);
    assert.equal(checkPickIsLegal(nodes, [before, after]), false);
});

test("test_pick_skipping_orphaned_node_is_legal", () => {
    // Scenario: orphaned (rewound-branch) nodes are unpickable and transparent to contiguity — picking the surviving nodes around one is legal.  Steps: build s45's turn timeline (its rewound step lands BETWEEN surviving turns chronologically).  locate the orphaned agent turn; assert it sits in no segment.  pick the nearest pickable neighbor on each side of it; assert the pick is legal.
    const { nodes } = buildTurnTimelineViewModel(s45Document);
    const segments = computePickSegments(nodes);
    const orphanIndex = nodes.findIndex((node: { isOrphaned?: boolean }) => node.isOrphaned === true);
    assert.ok(orphanIndex > 0);
    assert.equal(segments[orphanIndex], null);
    let before = -1;
    for (let index = orphanIndex - 1; index >= 0; index -= 1) {
        if (segments[index] !== null) {
            before = index;
            break;
        }
    }
    const after = segments.findIndex(
        (segment: number | null, index: number) => index > orphanIndex && segment !== null,
    );
    assert.ok(before >= 0);
    assert.ok(after > orphanIndex);
    assert.equal(checkPickIsLegal(nodes, [before, after]), true);
});

test("test_noncontiguous_pick_is_illegal", () => {
    // Scenario: a pick with an unpicked PICKABLE node inside its span is not contiguous.  Steps: build s84's turn timeline; find a segment holding three or more pickable nodes.  pick the first and third only (skipping the second); assert illegal.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const segments = computePickSegments(nodes);
    const pickablesBySegment = new Map<number, number[]>();
    segments.forEach((segment: number | null, index: number) => {
        if (segment === null) {
            return;
        }
        pickablesBySegment.set(segment, [...(pickablesBySegment.get(segment) ?? []), index]);
    });
    const trio = [...pickablesBySegment.values()].find((indexes) => indexes.length >= 3);
    assert.ok(trio !== undefined);
    assert.equal(checkPickIsLegal(nodes, [trio[0]!, trio[2]!]), false);
});

test("test_single_pick_is_legal", () => {
    // Scenario: one picked pickable node is always a legal (degenerate) range.  Steps: build s85's turn timeline; pick its first pickable node; assert legal.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    const first = segments.findIndex((segment: number | null) => segment !== null);
    assert.ok(first >= 0);
    assert.equal(checkPickIsLegal(nodes, [first]), true);
});

test("test_range_summary_counts_distinct_files", () => {
    // Scenario: the selection bar's "N steps picked · M files" counts DISTINCT file paths across the picked turn nodes.  Steps: build s85's turn timeline; pick the first two pickable nodes (their fileChanges overlap on none or some paths — the count must equal the union size computed independently here).
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    const picked: number[] = [];
    segments.forEach((segment: number | null, index: number) => {
        if (segment !== null && picked.length < 2) picked.push(index);
    });
    assert.equal(picked.length, 2);
    const summary = computeRangeSummary(nodes, picked);
    const expectedPaths = new Set(
        picked.flatMap((index) => nodes[index]!.fileChanges!.map((change: { path: string }) => change.path)),
    );
    assert.equal(summary.stepCount, 2);
    assert.deepEqual(new Set(summary.filePaths), expectedPaths);
});

test("test_range_summary_spans_underlying_snapshots_of_picked_turns", () => {
    // Scenario: /api/range-patch still speaks snapshot indexes — a picked turn range maps to the min..max snapshot index across ALL snapshots the picked turns own.  Steps: build s2's turn timeline; pick the first two pickable turn nodes.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const segments = computePickSegments(nodes);
    const picked: number[] = [];
    segments.forEach((segment: number | null, index: number) => {
        if (segment !== null && picked.length < 2) picked.push(index);
    });
    assert.equal(picked.length, 2);
    const summary = computeRangeSummary(nodes, picked);
    // the range spans the min..max snapshot index across BOTH nodes' snapshots.
    const snapshotIndexes = picked.flatMap((index) =>
        nodes[index]!.snapshots!.map((snapshot: { index: number }) => snapshot.index));
    assert.ok(snapshotIndexes.length >= 2);
    assert.equal(summary.fromStepIndex, Math.min(...snapshotIndexes));
    assert.equal(summary.toStepIndex, Math.max(...snapshotIndexes));
});

test("test_pick_segments_skip_user_turns_and_session_ends", () => {
    // Scenario: only agent turns that own surviving snapshots are pickable — user prompts,
    // session ends, commits, and snapshot-less agent replies all sit in no segment.
    // Steps:
    // build s85's turn timeline and compute its pick segments.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    nodes.forEach((node: { kind: string; snapshots?: { length: number } }, index: number) => {
        // every user-turn, session-end, and commit node is unpickable.
        if (node.kind !== AGENT_TURN_NODE_KIND) {
            assert.equal(segments[index], null);
            return;
        }
        // an agent reply that produced no file change is unpickable too.
        if (node.snapshots!.length === 0) {
            assert.equal(segments[index], null);
        }
    });
    // the check is not vacuous: pickable agent turns exist.
    assert.ok(segments.some((segment: number | null) => segment !== null));
});

test("test_checkSelectionBlocksBackgroundClose_blocks_when_selection_is_active", () => {
    // Scenario: finishing a text-selection drag over empty timeline background fires a click on the container; a non-collapsed selection means the user was selecting text, not asking to close the inspector (item 10b).  Steps: feed a fake Selection whose isCollapsed is false.  assert the predicate blocks the background close.
    assert.equal(checkSelectionBlocksBackgroundClose({ isCollapsed: false }), true);
});

test("test_checkSelectionBlocksBackgroundClose_allows_plain_clicks", () => {
    // Scenario: an ordinary background click (collapsed selection, or the null selection some browsers return) must still close the inspector.  Steps: assert a collapsed selection does not block the close.
    assert.equal(checkSelectionBlocksBackgroundClose({ isCollapsed: true }), false);
    // assert a null selection does not block the close.
    assert.equal(checkSelectionBlocksBackgroundClose(null), false);
});
