// buildTurnTimelineViewModel: synthetic turns, system flags, session-end nodes, orphan runs — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { computeGraphLaneRuns } from "../webapp/views/timeline-sessions.ts";
import {
    AGENT_TURN_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import {
    s84Document,
    s45Document,
} from "./timeline-test-helpers.ts";

test("test_trailing_snapshots_get_a_synthetic_agent_turn", () => {
    // Scenario: a snapshot with no later agent reply in its session must never be dropped — it
    // attaches to a synthetic empty-text agent turn placed before the session-end node.
    // Steps:
    // build a minimal document: one user prompt, TWO snapshots AFTER it, no assistant message.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "write two files",
        }],
        steps: [{
            index: 1,
            when: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
            changeIds: ["change-1"],
            changedPaths: ["notes.txt"],
            files: {},
        }, {
            index: 2,
            when: "2026-01-01T00:00:09.000Z",
            sessionId: "session-a",
            changeIds: ["change-2"],
            changedPaths: ["extra.txt"],
            files: {},
        }],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert exactly ONE synthetic agent turn exists, empty-texted, owning BOTH snapshots.
    const syntheticIndexes = nodes.flatMap((node: { kind: string }, index: number) =>
        node.kind === AGENT_TURN_NODE_KIND ? [index] : []);
    assert.equal(syntheticIndexes.length, 1);
    const synthetic = nodes[syntheticIndexes[0]!]!;
    assert.equal(synthetic.text, "");
    assert.equal(synthetic.snapshots!.length, 2);
    // assert it sits after the prompt and before the session-end node.
    const promptIndex = nodes.findIndex((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND);
    const endIndex = nodes.findIndex((node: { kind: string }) => node.kind === SESSION_END_NODE_KIND);
    assert.ok(promptIndex < syntheticIndexes[0]!);
    assert.ok(syntheticIndexes[0]! < endIndex);
});

test("test_command_message_turns_are_marked_system", () => {
    // Scenario: harness-generated turns (command-message prompts like /ponytail, system
    // reminders) are SYSTEM messages — the timeline renders them dimmer than genuine user
    // prompts and agent replies, so the view-model must flag them.
    // Steps:
    // build a minimal document: a /command prompt, a genuine prompt, and an agent reply.
    const document = {
        messages: [{
            uuid: "command-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "<command-message>ponytail:ponytail</command-message>\n<command-name>/ponytail</command-name>",
        }, {
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "write a file",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:20.000Z",
            text: "done",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const byUuid = (uuid: string) => nodes.find((node: { uuid?: string }) => node.uuid === uuid);
    // assert the command-message prompt is flagged system.
    assert.equal(byUuid("command-1")!.isSystem, true);
    // assert the genuine prompt and the agent reply are not.
    assert.equal(byUuid("prompt-1")!.isSystem, false);
    assert.equal(byUuid("reply-1")!.isSystem, false);
});

test("test_unattributed_snapshots_get_no_session_end_node", () => {
    // Scenario: snapshots with NO sessionId (e.g. unattributed script executions) still surface
    // on a synthetic agent turn, but they are not a session — no "end of session undefined" step.
    // Steps:
    // build a minimal document: one prompt in session-a, one unattributed snapshot after it.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "run the script",
        }],
        steps: [{
            index: 1,
            when: "2026-01-01T00:00:05.000Z",
            changeIds: ["change-1"],
            changedPaths: ["output.txt"],
            files: {},
        }],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the unattributed snapshot still lands on a synthetic agent turn.
    const synthetic = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    assert.ok(synthetic !== undefined);
    assert.equal(synthetic.snapshots!.length, 1);
    // assert exactly one session-end node exists — session-a's — and none for undefined.
    const sessionEnds = nodes.filter((node: { kind: string }) => node.kind === SESSION_END_NODE_KIND);
    assert.equal(sessionEnds.length, 1);
    assert.equal(sessionEnds[0]!.sessionId, "session-a");
});

test("test_session_end_node_closes_every_session", () => {
    // Scenario: every session ends with exactly one session-end step, positioned after every
    // conversation turn of that session and timestamped at the session's last turn. Unattributed
    // turns (no sessionId) are not a session and get none.
    // Steps:
    // build s84's turn timeline.
    const { nodes } = buildTurnTimelineViewModel(s84Document);
    const turnKinds = new Set([USER_TURN_NODE_KIND, AGENT_TURN_NODE_KIND]);
    const sessionIds = new Set(
        nodes
            .filter((node: { kind: string }) => turnKinds.has(node.kind))
            .map((node: { sessionId?: string }) => node.sessionId)
            .filter((sessionId: string | undefined) => sessionId !== undefined),
    );
    for (const sessionId of sessionIds) {
        // exactly one session-end node per session.
        const endIndexes = nodes.flatMap((node: { kind: string; sessionId?: string }, index: number) =>
            node.kind === SESSION_END_NODE_KIND && node.sessionId === sessionId ? [index] : []);
        assert.equal(endIndexes.length, 1);
        // positioned after every conversation turn of its session.
        const turnIndexes = nodes.flatMap((node: { kind: string; sessionId?: string }, index: number) =>
            turnKinds.has(node.kind) && node.sessionId === sessionId ? [index] : []);
        assert.ok(endIndexes[0]! > Math.max(...turnIndexes));
        // timestamped at the session's last turn.
        const lastTurnWhen = turnIndexes.map((index: number) => nodes[index]!.when).sort().at(-1);
        assert.equal(nodes[endIndexes[0]!]!.when, lastTurnWhen);
    }
});

// old (pre engine-stamped isOrphaned): the snapshot-proxy test below pinned the RETIRED rule —
// a turn dimmed only when EVERY owned snapshot resolved to a rewound-branch revision, so user
// prompts and tool rows on the abandoned branch could never dim. The engine now stamps
// per-record branch membership on the wire; the replacement test follows.
// test("test_orphaned_snapshots_dim_their_agent_turn", () => {
//     // Scenario: an agent turn whose snapshots ALL sit on a rewound branch is orphaned (dimmed,
//     // unpickable); a turn owning at least one surviving snapshot — or none at all — is not.
//     // Steps:
//     // build s45's turn timeline (s45 has a genuinely rewound step).
//     const { nodes } = buildTurnTimelineViewModel(s45Document);
//     const revisionIndex = indexRevisionsByChangeId(s45Document);
//     let orphanedCount = 0;
//     for (const node of nodes.filter((entry: { kind: string }) => entry.kind === AGENT_TURN_NODE_KIND)) {
//         // a snapshot-less agent turn is never orphaned.
//         if (node.snapshots!.length === 0) {
//             assert.equal(node.isOrphaned, false);
//             continue;
//         }
//         // otherwise orphaned exactly when EVERY owned snapshot is on the rewound branch.
//         const expected = node.snapshots!.every((snapshot) =>
//             checkStepIsOrphaned(snapshot, revisionIndex));
//         assert.equal(node.isOrphaned, expected);
//         if (expected) {
//             orphanedCount += 1;
//         }
//     }
//     // s45 has a rewound step, so the check is not vacuous.
//     assert.ok(orphanedCount >= 1);
// });

test("test_abandoned_branch_rows_dim_as_one_block", () => {
    // Scenario: EVERY row of a rewound (abandoned) conversation branch dims — the user prompt
    // that started it, the tool rows that ran on it, and the agent replies — as one contiguous
    // lane-2 block, driven by the engine's per-record isOrphaned stamp on the wire.
    // Steps:
    // build s45's turn timeline (s45 has a genuinely rewound exchange).
    const { nodes } = buildTurnTimelineViewModel(s45Document);
    // the orphaned rows span all three dimmable kinds — not just file-mutating agent turns.
    const orphanedKinds = new Set(
        nodes.filter((node: { isOrphaned?: boolean }) => node.isOrphaned === true)
            .map((node: { kind: string }) => node.kind),
    );
    assert.deepEqual(
        [...orphanedKinds].sort(),
        [AGENT_TURN_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND].sort(),
    );
    // the abandoned exchange is chronologically contiguous — exactly one fork-gutter lane run.
    assert.equal(computeGraphLaneRuns(nodes).length, 1);
});
