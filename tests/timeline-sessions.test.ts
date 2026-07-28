// timeline-sessions.ts over wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    buildSessionsSidebarViewModel,
    checkNodeIsAbandonedBranchTip,
    checkRowIsExpandable,
    computeGraphLaneRuns,
    findJsonlForSession,
} from "../webapp/views/timeline-sessions.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import {
    s84Document,
    s39SeedDocument,
    commitWalkDocument,
} from "./timeline-test-helpers.ts";

test("test_buildSessionsSidebarViewModel_groups_rows_per_session", () => {
    // One entry per distinct session in first-appearance order, over multi-session s84.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const entries = buildSessionsSidebarViewModel(nodes, undefined);
    const attributedIds = nodes
        .map((node: { sessionId?: string }) => node.sessionId)
        .filter((sessionId: string | undefined) => sessionId !== undefined);
    assert.equal(entries.length, new Set(attributedIds).size);
    for (const entry of entries) {
        assert.equal(entry.rowCount, attributedIds.filter((sessionId) => sessionId === entry.sessionId).length);
        assert.equal(nodes[entry.firstNodeIndex]!.sessionId, entry.sessionId);
        assert.ok(!nodes.slice(0, entry.firstNodeIndex).some((node: { sessionId?: string }) => node.sessionId === entry.sessionId));
        assert.equal(entry.shortLabel, entry.sessionId.slice(0, 8));
    }
    // Entries must follow first-appearance order.
    for (let i = 1; i < entries.length; i += 1) {
        assert.ok(entries[i]!.firstNodeIndex > entries[i - 1]!.firstNodeIndex);
    }
});

test("test_buildSessionsSidebarViewModel_matches_jsonl_by_session_prefix", () => {
    // An entry names the project JSONL whose file name starts with the session id.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "0a1b2c3d-4e5f",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "hello",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const listing = { name: "p", jsonlFiles: [{ fileName: "other.jsonl" }, { fileName: "0a1b2c3d-4e5f.jsonl" }] };
    const entries = buildSessionsSidebarViewModel(nodes, listing);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.jsonlFileName, "0a1b2c3d-4e5f.jsonl");
    assert.equal(findJsonlForSession(listing, "ffffffff"), undefined);
    assert.equal(findJsonlForSession(listing, undefined), undefined);
});

test("test_computeGraphLaneRuns_finds_contiguous_orphan_runs", () => {
    // One lane-2 rail per CONTIGUOUS orphan run: commit-walk's orphans at 3 and 4 are one run.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    assert.deepEqual(computeGraphLaneRuns(nodes), [{ startIndex: 3, endIndex: 4 }]);
});

test("test_computeGraphLaneRuns_returns_empty_when_nothing_is_orphaned", () => {
    // The s39 seed session is linear, so no lane-2 rail is drawn at all.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    assert.ok(nodes.length > 0);
    assert.deepEqual(computeGraphLaneRuns(nodes), []);
});

test("test_checkRowIsExpandable_excludes_commits_and_session_ends", () => {
    // Commit and session-end rows are thin one-liners; every turn and tool-call row expands.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const byKind = (kind: string) => nodes.find((node: { kind: string }) => node.kind === kind)!;
    assert.equal(checkRowIsExpandable(byKind(COMMIT_NODE_KIND)), false);
    assert.equal(checkRowIsExpandable(byKind(SESSION_END_NODE_KIND)), false);
    assert.equal(checkRowIsExpandable(byKind(USER_TURN_NODE_KIND)), true);
    assert.equal(checkRowIsExpandable(byKind(AGENT_TURN_NODE_KIND)), true);
    // The s39 seed session supplies a real tool-call row.
    const { nodes: seedNodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const toolCall = seedNodes.find((node: { kind: string }) => node.kind === TOOL_CALL_NODE_KIND)!;
    assert.equal(checkRowIsExpandable(toolCall), true);
});

// (task 85 findAdjacentFileTouchedIndex, task 131 findAdjacentRowIndex, and task 135
// checkRowCarriesJsonRecordButton tests live in timeline-row-navigation.test.ts — 250-line cap.)

test("test_checkNodeIsAbandonedBranchTip_marks_last_orphaned_row_per_session", () => {
    // Task 158: the "(abandoned)" pill lands on the LAST row of an abandoned run, so of
    // commit-walk's orphans at 3 and 4 only 4 is the tip.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 3), false);
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 4), true);
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 0), false);
    // An interleaved OTHER-session surviving row landing after the tip must not mask it.
    const turn = (sessionId: string, isOrphaned: boolean): TurnNode =>
        ({ kind: USER_TURN_NODE_KIND, when: "t1", sessionId, text: "", snapshots: [], gitOperations: [], isOrphaned });
    const interleaved = [turn("a", true), turn("b", false), turn("a", false)];
    assert.equal(checkNodeIsAbandonedBranchTip(interleaved, 0), true);
    // A later same-session orphaned row means the run continues.
    const continuing = [turn("a", true), turn("b", false), turn("a", true)];
    assert.equal(checkNodeIsAbandonedBranchTip(continuing, 0), false);
    assert.equal(checkNodeIsAbandonedBranchTip(continuing, 2), true);
});

test("test_checkRowIsExpandable_expands_only_merged_baseline_commit_rows", () => {
    // Task 121: only the merged git-derived baseline commit row expands, to show its file chips.
    const mergedBaselineCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s", isGitBaseline: true };
    assert.equal(checkRowIsExpandable(mergedBaselineCommit), true);
    const plainCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s" };
    assert.equal(checkRowIsExpandable(plainCommit), false);
});
