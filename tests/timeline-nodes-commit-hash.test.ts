// buildTurnTimelineViewModel: commit nodes copy the engine's resultHash — wire-shape inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { GitOperationKind } from "../src/structures/vocabulary_views.ts";

test("test_commit_nodes_carry_result_hash_from_git_operations", () => {
    // Scenario: the engine ships the commit's short hash on the wire (GitOperation.resultHash,
    // item 66 locked decision 2) — buildCommitNodes must copy it onto the commit node so the
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
