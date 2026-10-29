// computeCommitChangedFiles around a session's first commit — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeCommitChangedFiles,
    findContributingNodeIndexes,
} from "../webapp/views/timeline-commit-files.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    RecordType,
    EventKind,
} from "../src/structures/vocabulary.ts";
import { GitOperationKind } from "../src/structures/vocabulary_views.ts";
import { findCommitNodeIndexes } from "./timeline-test-helpers.ts";

// First-commit document (task 87): the reply bubble (00:40) sorts AFTER the commit row (00:30).

const firstCommitDocument = {
    messages: [{
        uuid: "prompt-1",
        role: RecordType.user,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:00.000Z",
        text: "write alpha and commit it",
    }, {
        uuid: "reply-1",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:40.000Z",
        text: "wrote alpha and committed",
    }],
    steps: [
        { index: 1, when: "2025-12-31T00:00:00.000Z", sessionId: undefined, changeIds: ["gitBase:abc1234:orders.py"], changedPaths: [], files: {} },
        { index: 2, when: "2026-01-01T00:00:25.000Z", sessionId: "session-a", changeIds: ["change-alpha-1"], changedPaths: [], files: {} },
        { index: 3, when: "2026-01-01T00:00:50.000Z", sessionId: "session-a", changeIds: ["change-beta-1"], changedPaths: [], files: {} },
    ],
    filesTouched: [{
        target: "orders.py",
        revisions: [{ kind: EventKind.write, changeId: "gitBase:abc1234:orders.py", timestamp: "2025-12-31T00:00:00.000Z" }],
    }, {
        target: "alpha.py",
        revisions: [{ kind: EventKind.write, changeId: "change-alpha-1", timestamp: "2026-01-01T00:00:25.000Z" }],
    }, {
        target: "beta.py",
        revisions: [{ kind: EventKind.write, changeId: "change-beta-1", timestamp: "2026-01-01T00:00:50.000Z" }],
    }],
    rewoundFilesTouched: [],
    commitMarkers: [],
    gitOperations: [{
        kind: GitOperationKind.commit,
        detail: "first",
        command: 'git commit -m "first"',
        timestamp: "2026-01-01T00:00:30.000Z",
        sessionId: "session-a",
    }],
};

test("test_computeCommitChangedFiles_absorbs_trailing_bubble_for_first_commit", () => {
    // Scenario: the forward absorb lists chips on the reply bubble after the FIRST commit (task 87).
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the pre-commit change (00:25 <= 00:30) is absorbed from the trailing bubble.
    const paths = computeCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(paths.includes("alpha.py"));
});

test("test_computeCommitChangedFiles_excludes_changes_made_after_the_commit", () => {
    // Scenario: the forward absorb takes ONLY chips at or before the commit; later work stays out.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the post-commit change is not listed.
    const paths = computeCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("beta.py"));
});

test("test_computeCommitChangedFiles_never_lists_git_baseline_chips", () => {
    // Scenario: baseline seeds are pre-session state, so the commit never lists their chips.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the gitBase-seeded path is not listed.
    const paths = computeCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("orders.py"));
});

test("test_computeCommitChangedFiles_forward_walk_stops_at_next_commit", () => {
    // Scenario: the forward absorb never crosses the NEXT commit row. Steps: add a second commit before the bubble.
    const document = {
        ...firstCommitDocument,
        gitOperations: [...firstCommitDocument.gitOperations, {
            kind: GitOperationKind.commit,
            detail: "second",
            command: 'git commit -m "second"',
            timestamp: "2026-01-01T00:00:35.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const [firstCommitIndex, secondCommitIndex] = findCommitNodeIndexes(nodes);
    // assert the first commit's forward walk stopped at the second commit (no absorb).
    assert.deepEqual(computeCommitChangedFiles(nodes, firstCommitIndex!), []);
    // assert the second commit absorbed the trailing bubble's pre-commit chip instead.
    const secondPaths = computeCommitChangedFiles(nodes, secondCommitIndex!).map((change) => change.path);
    assert.ok(secondPaths.includes("alpha.py"));
});

test("test_findContributingNodeIndexes_includes_trailing_bubble", () => {
    // Scenario: the highlight includes the trailing bubble the forward absorb took chips from (task 87).
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    const replyIndex = nodes.findIndex((node) => node.uuid === "reply-1");
    // assert the reply row is listed as contributing.
    assert.ok(findContributingNodeIndexes(nodes, commitIndex!).includes(replyIndex));
});
