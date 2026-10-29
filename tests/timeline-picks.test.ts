// Pick legality and background-close guard (timeline-picks.ts), using shared timeline fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    isPickLegal,
    isSelectionBlockingBackgroundClose,
    computePickSegments,
} from "../webapp/views/timeline-picks.ts";
import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import {
    s84Document,
    s85Document,
    s45Document,
} from "./timeline-test-helpers.ts";

test("test_pick_crossing_commit_is_illegal", () => {
    // A pick range can never cross a git commit node.
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
    assert.equal(isPickLegal(nodes, [before, after]), false);
});

test("test_pick_skipping_orphaned_node_is_legal", () => {
    // Orphaned nodes are unpickable but transparent: picks around one stay legal.
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
    assert.equal(isPickLegal(nodes, [before, after]), true);
});

test("test_noncontiguous_pick_is_illegal", () => {
    // Skipping an unpicked pickable node inside the span makes the pick illegal.
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
    assert.equal(isPickLegal(nodes, [trio[0]!, trio[2]!]), false);
});

test("test_single_pick_is_legal", () => {
    // One picked pickable node is always a legal range.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const segments = computePickSegments(nodes);
    const first = segments.findIndex((segment: number | null) => segment !== null);
    assert.ok(first >= 0);
    assert.equal(isPickLegal(nodes, [first]), true);
});

test("test_isSelectionBlockingBackgroundClose_blocks_when_selection_is_active", () => {
    // A non-collapsed selection means a text drag, so the background click must not close.
    assert.equal(isSelectionBlockingBackgroundClose({ isCollapsed: false }), true);
});

test("test_isSelectionBlockingBackgroundClose_allows_plain_clicks", () => {
    // Collapsed and null selections must still close the inspector.
    assert.equal(isSelectionBlockingBackgroundClose({ isCollapsed: true }), false);
    assert.equal(isSelectionBlockingBackgroundClose(null), false);
});
