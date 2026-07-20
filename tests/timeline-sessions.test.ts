// sessions sidebar, lane runs, expandable rows, file-touched navigation (timeline-sessions.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    buildSessionsSidebarViewModel,
    checkRowIsExpandable,
    computeGraphLaneRuns,
    findAdjacentFileTouchedIndex,
    findJsonlForSession,
} from "../webapp/views/timeline-sessions.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type FileChange,
    type TimelineNode,
} from "../webapp/views/timeline-types.ts";
import {
    RecordType,
    EventKind,
} from "../src/structures/vocabulary.ts";
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

// ── task 85: header Prev/Next over file-touching agent turns ──
// findAdjacentFileTouchedIndex reads only kind + fileChanges, so hand-built minimal turn
// nodes (wire shape) exercise it fully.

function makeTurnNodeFixture(
    kind: typeof USER_TURN_NODE_KIND | typeof AGENT_TURN_NODE_KIND,
    fileChanges: FileChange[],
): TimelineNode {
    return {
        kind,
        when: "2026-01-01T00:00:00.000Z",
        sessionId: undefined,
        text: "",
        snapshots: [],
        gitOperations: [],
        fileChanges,
    };
}

const singleFileChangeFixture: FileChange[] = [{
    path: "orders.py",
    displayPath: "orders.py",
    eventKind: EventKind.edit,
    renamedFrom: undefined,
    isFirstRevision: false,
    changeId: undefined,
    when: "2026-01-01T00:00:00.000Z",
}];

test("test_findAdjacentFileTouchedIndex_next_from_before_start_finds_first_candidate", () => {
    // Behavior: with the reference before the first row (-1), Next lands on the first
    // agent turn that carries file chips.
    // Steps:
    // a user turn, then a chipless agent turn, then an agent turn with chips.
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching forward from -1 returns the chip-bearing row's index.
    assert.equal(findAdjacentFileTouchedIndex(nodes, -1, 1), 2);
});

test("test_findAdjacentFileTouchedIndex_next_skips_non_agent_and_chipless_rows", () => {
    // Behavior: Next skips user turns and agent turns without file changes.
    // Steps:
    // a chip-bearing agent turn, a user turn, a chipless agent turn, a chip-bearing agent turn.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching forward from index 0 skips indexes 1 and 2 and lands on 3.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), 3);
});

test("test_findAdjacentFileTouchedIndex_prev_finds_nearest_earlier_candidate", () => {
    // Behavior: Prev walks backwards to the nearest earlier chip-bearing agent turn.
    // Steps:
    // same four rows as the skip test, searching backward from the last row.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching backward from index 3 skips indexes 2 and 1 and lands on 0.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 3, -1), 0);
});

test("test_findAdjacentFileTouchedIndex_returns_undefined_when_no_candidate_in_direction", () => {
    // Behavior: walking off either end without a candidate is undefined (button no-op).
    // Steps:
    // one chip-bearing agent turn followed only by a user turn.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
    ];
    // searching forward from index 0 finds nothing.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), undefined);
});
