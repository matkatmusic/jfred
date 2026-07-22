// task 133: merged-chip dedupe on one turn (timeline-changes.ts mergeSnapshotFileChanges) —
// two snapshots holding DISTINCT revisions of the SAME file must each keep their chip
// (baseline-demo: an external user-edit's chip swallowed the agent Edit's), while a repeat of
// the SAME revision still collapses. Lives beside timeline-changes.test.ts (that file sits at
// the 250-line hook cap; timeline-changes-baseline.test.ts is the split precedent).

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNodeFileChanges, indexRevisionsByChangeId } from "../webapp/views/timeline-changes.ts";
import { AGENT_TURN_NODE_KIND, type TimelineNode, type WireStepSnapshot, type WireTimelineDocument } from "../webapp/views/timeline-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

const INVENTORY_TARGET = "/w/inventory.py";
const USER_EDIT_CHANGE_ID = "user-edit-change-1";
const AGENT_EDIT_CHANGE_ID = "toolu_edit_change_2";

// The two revisions of the one file: an external user-edit then an agent Edit — the
// baseline-demo shape whose second chip was swallowed by the path-keyed merge dedupe.
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
    // Scenario (task 133): a turn owning an external user-edit snapshot AND an agent Edit
    // snapshot of the SAME file shows BOTH chips — the later revision's chip must not be
    // swallowed by the earlier one.
    // Steps:
    // index the two-revision document.
    const document = buildTwoRevisionDocument();
    const revisionIndex = indexRevisionsByChangeId(document);
    // one agent turn owning both snapshots, in event order.
    const node = buildAgentTurnNode([
        buildSnapshot(1, "2026-07-17T23:44:01.904Z", [USER_EDIT_CHANGE_ID]),
        buildSnapshot(2, "2026-07-17T23:44:09.283Z", [AGENT_EDIT_CHANGE_ID]),
    ]);
    // stamp the merged chips.
    deriveNodeFileChanges([node], revisionIndex);
    // both revisions keep their chip, in snapshot order.
    assert.equal(node.fileChanges!.length, 2);
    assert.deepEqual(node.fileChanges!.map((change) => change.changeId), [USER_EDIT_CHANGE_ID, AGENT_EDIT_CHANGE_ID]);
});

test("test_repeated_changeid_across_snapshots_still_collapses", () => {
    // Scenario (task 133): the SAME revision echoing across two snapshots on one turn still
    // collapses to a single chip — the fix widens the dedupe key to path+changeId, not off.
    // Steps:
    // index the two-revision document.
    const document = buildTwoRevisionDocument();
    const revisionIndex = indexRevisionsByChangeId(document);
    // one agent turn owning two snapshots that repeat the SAME changeId.
    const node = buildAgentTurnNode([
        buildSnapshot(1, "2026-07-17T23:44:01.904Z", [USER_EDIT_CHANGE_ID]),
        buildSnapshot(2, "2026-07-17T23:44:02.000Z", [USER_EDIT_CHANGE_ID]),
    ]);
    // stamp the merged chips.
    deriveNodeFileChanges([node], revisionIndex);
    // the repeat collapses to one chip.
    assert.equal(node.fileChanges!.length, 1);
    assert.equal(node.fileChanges![0]!.changeId, USER_EDIT_CHANGE_ID);
});
