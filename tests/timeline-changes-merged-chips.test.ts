// Merged-chip dedupe on one turn: distinct revisions of one file keep their chips; a repeated revision collapses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRevisionIndex } from "../webapp/views/timeline-changes.ts";
import { applyNodeFileChanges } from "../webapp/views/timeline-node-file-changes.ts";
import { AGENT_TURN_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { TimelineNode } from "../webapp/views/timeline-node-types.ts";
import type { WireStepSnapshot, WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

const INVENTORY_TARGET = "/w/inventory.py";
const USER_EDIT_CHANGE_ID = "user-edit-change-1";
const AGENT_EDIT_CHANGE_ID = "toolu_edit_change_2";

// Two revisions of one file: an external user edit, then an agent Edit.
const TWO_REVISIONS = [
    { kind: EventKind.userEdit, changeId: USER_EDIT_CHANGE_ID, timestamp: "2026-07-17T23:44:01.904Z" },
    { kind: EventKind.edit, changeId: AGENT_EDIT_CHANGE_ID, timestamp: "2026-07-17T23:44:09.283Z" },
];

function buildTwoRevisionDocument(): WireTimelineDocument {
    return {
        filesTouched: [{ target: INVENTORY_TARGET, revisions: TWO_REVISIONS }],
        rewoundFilesTouched: [],
        messages: [],
        steps: [],
        commitMarkers: [],
    };
}

function buildSnapshot(index: number, when: string, changeIds: string[]): WireStepSnapshot {
    return { index, when, changeIds, changedPaths: [] };
}

// One agent-turn node owning `snapshots`, shaped like buildTurnTimelineViewModel's turn output.
function buildAgentTurnNode(snapshots: WireStepSnapshot[]): TimelineNode {
    return {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-07-17T23:44:13.557Z",
        sessionId: "session-1",
        uuid: "agent-turn-uuid",
        text: "added least_valuable(store)",
        snapshots,
        gitOperations: [],
    } as TimelineNode;
}

test("test_two_snapshots_with_distinct_revisions_of_one_file_keep_both_chips", () => {
    // A turn owning a user-edit snapshot and an agent Edit snapshot of one file shows both chips.
    const document = buildTwoRevisionDocument();
    const revisionIndex = buildRevisionIndex(document);
    // one agent turn owning both snapshots, in event order.
    const node = buildAgentTurnNode([
        buildSnapshot(1, "2026-07-17T23:44:01.904Z", [USER_EDIT_CHANGE_ID]),
        buildSnapshot(2, "2026-07-17T23:44:09.283Z", [AGENT_EDIT_CHANGE_ID]),
    ]);
    // stamp the merged chips.
    applyNodeFileChanges([node], revisionIndex);
    // both revisions keep their chip, in snapshot order.
    assert.equal(node.fileChanges!.length, 2);
    assert.deepEqual(node.fileChanges!.map((change) => change.changeId), [USER_EDIT_CHANGE_ID, AGENT_EDIT_CHANGE_ID]);
});

test("test_repeated_changeid_across_snapshots_still_collapses", () => {
    // The same revision echoed across two snapshots on one turn still collapses to one chip.
    const document = buildTwoRevisionDocument();
    const revisionIndex = buildRevisionIndex(document);
    // one agent turn owning two snapshots that repeat the SAME changeId.
    const node = buildAgentTurnNode([
        buildSnapshot(1, "2026-07-17T23:44:01.904Z", [USER_EDIT_CHANGE_ID]),
        buildSnapshot(2, "2026-07-17T23:44:02.000Z", [USER_EDIT_CHANGE_ID]),
    ]);
    // stamp the merged chips.
    applyNodeFileChanges([node], revisionIndex);
    // the repeat collapses to one chip.
    assert.equal(node.fileChanges!.length, 1);
    assert.equal(node.fileChanges![0]!.changeId, USER_EDIT_CHANGE_ID);
});
