// buildTurnTimelineViewModel: commit-node derivation from git operations and markers — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { GitOperationKind } from "../src/structures/vocabulary_views.ts";

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
    // Scenario (item 55): gitOperations without toolCalls still yields commit nodes carrying the message.
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
    // Scenario: with gitOperations present, commit nodes come from them, not from commitMarkers.
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
    // Scenario: a document without gitOperations still yields commit nodes from commitMarkers.
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
