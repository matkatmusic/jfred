// sessions sidebar, lane runs, expandable rows, file-touched navigation (timeline-sessions.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

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
    // Scenario: the Sessions sidebar shows one entry per distinct session in first-appearance
    // order, counting that session's rows and remembering its first row for flash-scroll.
    // Steps:
    // build s84's timeline (multi-session) and the sessions sidebar with no listing.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const entries = buildSessionsSidebarViewModel(nodes, undefined);
    // assert one entry per distinct attributed sessionId.
    const attributedIds = nodes
        .map((node: { sessionId?: string }) => node.sessionId)
        .filter((sessionId: string | undefined) => sessionId !== undefined);
    assert.equal(entries.length, new Set(attributedIds).size);
    for (const entry of entries) {
        // each entry counts exactly its session's rows.
        assert.equal(entry.rowCount, attributedIds.filter((sessionId) => sessionId === entry.sessionId).length);
        // firstNodeIndex is the session's first row.
        assert.equal(nodes[entry.firstNodeIndex]!.sessionId, entry.sessionId);
        assert.ok(!nodes.slice(0, entry.firstNodeIndex).some((node: { sessionId?: string }) => node.sessionId === entry.sessionId));
        // the short label is the session's first 8 chars.
        assert.equal(entry.shortLabel, entry.sessionId.slice(0, 8));
    }
    // entries follow first-appearance order.
    for (let i = 1; i < entries.length; i += 1) {
        assert.ok(entries[i]!.firstNodeIndex > entries[i - 1]!.firstNodeIndex);
    }
});

test("test_buildSessionsSidebarViewModel_matches_jsonl_by_session_prefix", () => {
    // Scenario: a session's sidebar entry names the project JSONL whose file name starts with the
    // session id (the lifted findJsonlForSession rule); no match → undefined.
    // Steps:
    // build a one-prompt timeline and a listing where the second file matches the session prefix.
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
    // assert the entry resolves the matching JSONL file name.
    const entries = buildSessionsSidebarViewModel(nodes, listing);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.jsonlFileName, "0a1b2c3d-4e5f.jsonl");
    // assert the lifted helper returns undefined when nothing matches or nothing is asked.
    assert.equal(findJsonlForSession(listing, "ffffffff"), undefined);
    assert.equal(findJsonlForSession(listing, undefined), undefined);
});

test("test_computeGraphLaneRuns_finds_contiguous_orphan_runs", () => {
    // Scenario: the fork gutter draws one lane-2 rail per CONTIGUOUS run of orphaned rows — the
    // commit-walk timeline's two adjacent orphaned replies form exactly one run.
    // Steps:
    // build the commit-walk timeline (orphans at node indexes 3 and 4).
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    assert.deepEqual(computeGraphLaneRuns(nodes), [{ startIndex: 3, endIndex: 4 }]);
});

test("test_computeGraphLaneRuns_returns_empty_when_nothing_is_orphaned", () => {
    // Scenario: a timeline with no rewound branch draws no lane-2 rail at all.
    // Steps:
    // build the s39 seed-session timeline (linear, no rewinds).
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    assert.ok(nodes.length > 0);
    assert.deepEqual(computeGraphLaneRuns(nodes), []);
});

test("test_checkRowIsExpandable_excludes_commits_and_session_ends", () => {
    // Scenario: commit and session-end rows are thin one-liners with no tri and no bubble;
    // user turns, agent turns, and tool-call rows all expand.
    // Steps:
    // build the commit-walk timeline for the turn/commit/end kinds.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const byKind = (kind: string) => nodes.find((node: { kind: string }) => node.kind === kind)!;
    assert.equal(checkRowIsExpandable(byKind(COMMIT_NODE_KIND)), false);
    assert.equal(checkRowIsExpandable(byKind(SESSION_END_NODE_KIND)), false);
    assert.equal(checkRowIsExpandable(byKind(USER_TURN_NODE_KIND)), true);
    assert.equal(checkRowIsExpandable(byKind(AGENT_TURN_NODE_KIND)), true);
    // the s39 seed session supplies a real tool-call row — it expands too.
    const { nodes: seedNodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const toolCall = seedNodes.find((node: { kind: string }) => node.kind === TOOL_CALL_NODE_KIND)!;
    assert.equal(checkRowIsExpandable(toolCall), true);
});

// (task 85 findAdjacentFileTouchedIndex, task 131 findAdjacentRowIndex, and task 135
// checkRowCarriesJsonRecordButton tests live in timeline-row-navigation.test.ts — 250-line cap.)

test("test_checkNodeIsAbandonedBranchTip_marks_last_orphaned_row_per_session", () => {
    // Scenario (task 158): the "(abandoned)" pill lands on the LAST row of an abandoned run —
    // an orphaned node whose next SAME-session node is not orphaned, or that has none after it.
    // Steps:
    // the commit-walk timeline's orphans sit at node indexes 3 and 4 — only 4 is the tip.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 3), false);
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 4), true);
    // a surviving row is never a tip.
    assert.equal(checkNodeIsAbandonedBranchTip(nodes, 0), false);
    // an interleaved OTHER-session surviving row landing after the tip must not mask it.
    const turn = (sessionId: string, isOrphaned: boolean): TurnNode =>
        ({ kind: USER_TURN_NODE_KIND, when: "t1", sessionId, text: "", snapshots: [], gitOperations: [], isOrphaned });
    const interleaved = [turn("a", true), turn("b", false), turn("a", false)];
    assert.equal(checkNodeIsAbandonedBranchTip(interleaved, 0), true);
    // a later same-session orphaned row means the run continues — not the tip yet.
    const continuing = [turn("a", true), turn("b", false), turn("a", true)];
    assert.equal(checkNodeIsAbandonedBranchTip(continuing, 0), false);
    assert.equal(checkNodeIsAbandonedBranchTip(continuing, 2), true);
});

test("test_checkRowIsExpandable_expands_only_merged_baseline_commit_rows", () => {
    // Scenario (task 121): the merged git-derived baseline commit row expands to show its file
    // chips; plain commit rows stay thin one-liners (locked decision 4 intact).
    // Steps:
    // a commit node flagged isGitBaseline expands.
    const mergedBaselineCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s", isGitBaseline: true };
    assert.equal(checkRowIsExpandable(mergedBaselineCommit), true);
    // a plain commit node does not.
    const plainCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s" };
    assert.equal(checkRowIsExpandable(plainCommit), false);
});
