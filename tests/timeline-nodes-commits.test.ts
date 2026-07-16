// buildTurnTimelineViewModel: commit-node derivation from git operations and markers — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    RecordType,
    GitOperationKind,
} from "../src/structures/vocabulary.ts";

// item 55 (adjusted 2026-07-09): the snapshot attribution rule for git operations was retired
// with the turn-bubble git rows (attachGitOperationsToAgentTurns is unused). The replacement
// test below keeps this minimal document and pins what the view-model still derives from
// gitOperations: the commit hard-stop nodes.
// test("test_git_operations_attach_by_the_snapshot_attribution_rule", () => {
//     // Scenario: a git operation belongs to the FIRST agent reply of its own session at or after
//     // it (the snapshot rule); an operation AFTER the session's last reply falls back to that last
//     // reply so no recorded git command is silently dropped.
//     ... (body preserved in the replacement test below; assertions were:
//     reply.gitOperations kinds deep-equal [GitOperationKind.init, GitOperationKind.commit])

test("test_commit_nodes_derive_from_git_operations_without_tool_calls", () => {
    // Scenario (item 55): a document carrying gitOperations but no toolCalls (an older cached
    // shape) still yields its commit hard-stop node — with the commit message as its detail —
    // while agent turns own no git rows.
    // Steps:
    // build a minimal document: prompt, one reply, one operation before the reply, one after it.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "make a repo and commit",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "done",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
        gitOperations: [{
            kind: GitOperationKind.init,
            detail: "",
            command: "git init",
            timestamp: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
        }, {
            kind: GitOperationKind.commit,
            detail: "baseline",
            command: 'git commit -m "baseline"',
            timestamp: "2026-01-01T00:00:20.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the reply turn owns NO git rows (the item-55 retirement holds).
    const reply = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)!;
    assert.deepEqual(reply.gitOperations ?? [], []);
    // assert the commit operation still surfaces as a commit hard-stop node with its message.
    const commitNodes = nodes.filter((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNodes.length, 1);
    assert.equal(commitNodes[0]!.when, "2026-01-01T00:00:20.000Z");
    assert.equal(commitNodes[0]!.detail, "baseline");
});

test("test_commit_nodes_derive_from_git_operations", () => {
    // Scenario: when the document ships gitOperations, the pick hard-stops come from its commit
    // operations — carrying the commit message — not from commitMarkers.
    // Steps:
    // build a minimal document whose ONLY commit signal is a gitOperations entry.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "commit it",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "committed",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
        gitOperations: [{
            kind: GitOperationKind.commit,
            detail: "baseline",
            command: 'git commit -m "baseline"',
            timestamp: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert exactly one commit node exists, at the operation's instant, with its message.
    const commitNodes = nodes.filter((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNodes.length, 1);
    assert.equal(commitNodes[0]!.when, "2026-01-01T00:00:05.000Z");
    assert.equal(commitNodes[0]!.detail, "baseline");
});

test("test_commit_nodes_fall_back_to_commit_markers", () => {
    // Scenario: an older cached document has NO gitOperations field; its commitMarkers must
    // still produce the commit hard-stops (and agent turns still expose an empty operations list).
    // Steps:
    // build a minimal document with a commitMarker and no gitOperations key.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "commit it",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "committed",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [{ timestamp: "2026-01-01T00:00:05.000Z", sessionId: "session-a" }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the marker still yields its commit node.
    const commitNodes = nodes.filter((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNodes.length, 1);
    assert.equal(commitNodes[0]!.when, "2026-01-01T00:00:05.000Z");
    // assert the reply turn carries an (empty) operations list, so the render half can map it.
    const reply = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)!;
    assert.deepEqual(reply.gitOperations, []);
});

test("test_commit_nodes_carry_result_hash_from_git_operations", () => {
    // Scenario: the engine ships the commit's short hash on the wire (GitOperation.resultHash,
    // item 66 locked decision 2) — deriveCommitNodes must copy it onto the commit node so the
    // render can show the `GIT COMMIT [hash]` pill; an operation without one stays undefined.
    // Steps:
    // build a minimal document with two commit operations, one carrying a resultHash.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "commit it",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
        gitOperations: [{
            kind: GitOperationKind.commit,
            detail: "fix: x",
            command: 'git commit -m "fix: x"',
            timestamp: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
            resultHash: "4fa08d2",
        }, {
            kind: GitOperationKind.commit,
            detail: "later",
            command: 'git commit -m "later"',
            timestamp: "2026-01-01T00:00:10.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the first commit node carries the operation's hash.
    const commitNodes = nodes.filter((node: { kind: string }) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNodes.length, 2);
    assert.equal(commitNodes[0]!.resultHash, "4fa08d2");
    // assert the hash-less operation's node has no hash.
    assert.equal(commitNodes[1]!.resultHash, undefined);
});
