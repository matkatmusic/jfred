// Pick segments and range summaries (timeline-picks.ts), using shared timeline fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { computePickSegments, computeRangeSummary } from "../webapp/views/timeline-picks.ts";
import { AGENT_TURN_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { s85Document, s2Document } from "./timeline-test-helpers.ts";

test("test_range_summary_counts_distinct_files", () => {
    // The selection bar file count is the union of distinct paths across picked nodes.
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
    // The range-patch step range is min to max snapshot index across all picked turns.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const segments = computePickSegments(nodes);
    const picked: number[] = [];
    segments.forEach((segment: number | null, index: number) => {
        if (segment !== null && picked.length < 2) picked.push(index);
    });
    assert.equal(picked.length, 2);
    const summary = computeRangeSummary(nodes, picked);
    const snapshotIndexes = picked.flatMap((index) =>
        nodes[index]!.snapshots!.map((snapshot: { index: number }) => snapshot.index));
    assert.ok(snapshotIndexes.length >= 2);
    assert.equal(summary.fromStepIndex, Math.min(...snapshotIndexes));
    assert.equal(summary.toStepIndex, Math.max(...snapshotIndexes));
});

test("test_pick_segments_skip_user_turns_and_session_ends", () => {
    // Only agent turns owning surviving snapshots sit in a segment; all other nodes get null.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    nodes.forEach((node: { kind: string; snapshots?: { length: number } }, index: number) => {
        if (node.kind !== AGENT_TURN_NODE_KIND) {
            assert.equal(segments[index], null);
            return;
        }
        if (node.snapshots!.length === 0) {
            assert.equal(segments[index], null);
        }
    });
    assert.ok(segments.some((segment: number | null) => segment !== null));
});
