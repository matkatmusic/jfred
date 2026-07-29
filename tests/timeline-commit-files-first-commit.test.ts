// deriveCommitChangedFiles around a session's first commit — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    deriveCommitChangedFiles,
    findContributingNodeIndexes,
} from "../webapp/views/timeline-commit-files.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    RecordType,
    EventKind,
    GitOperationKind,
} from "../src/structures/vocabulary.ts";
import { findCommitNodeIndexes } from "./timeline-test-helpers.ts";

// First-commit document (task 87): the only work happens mid-turn before the commit, so the chips' owning reply bubble (00:40) sorts AFTER the commit row (00:30); a second change (00:50) happens after the commit. A gitBase baseline step seeds orders.py before everything.

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

test("test_deriveCommitChangedFiles_absorbs_trailing_bubble_for_first_commit", () => {
    // Scenario: the FIRST commit's chips live on the reply bubble sorted after it (snapshot attribution); the forward absorb lists them instead of "No files changed" (task 87).  Steps: build the timeline and take the first (only) commit.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the pre-commit change (00:25 <= 00:30) is absorbed from the trailing bubble.
    const paths = deriveCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(paths.includes("alpha.py"));
});

test("test_deriveCommitChangedFiles_excludes_changes_made_after_the_commit", () => {
    // Scenario: the forward absorb takes ONLY chips whose change instant is at-or-before the commit — work done after the commit (00:50 > 00:30) stays out.  Steps: build the timeline and take the commit.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the post-commit change is not listed.
    const paths = deriveCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("beta.py"));
});

test("test_deriveCommitChangedFiles_never_lists_git_baseline_chips", () => {
    // Scenario: baseline seeds are pre-session repo state, never part of a commit's delta — the baseline node sorts before the first commit but its chips must not be listed.  Steps: build the timeline and take the commit.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert the gitBase-seeded path is not listed.
    const paths = deriveCommitChangedFiles(nodes, commitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("orders.py"));
});

test("test_deriveCommitChangedFiles_forward_walk_stops_at_next_commit", () => {
    // Scenario: the forward absorb never crosses the NEXT commit row — a qualifying chip sitting beyond it belongs to that later commit's window.  Steps: add a second commit between the first commit and the trailing bubble.
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
    assert.deepEqual(deriveCommitChangedFiles(nodes, firstCommitIndex!), []);
    // assert the second commit absorbed the trailing bubble's pre-commit chip instead.
    const secondPaths = deriveCommitChangedFiles(nodes, secondCommitIndex!).map((change) => change.path);
    assert.ok(secondPaths.includes("alpha.py"));
});

test("test_findContributingNodeIndexes_includes_trailing_bubble", () => {
    // Scenario: the commit's contributing-row highlight includes the trailing bubble the forward absorb took chips from (task 87 — the walk and the highlight must agree).  Steps: build the timeline, take the commit, and locate the trailing reply bubble.
    const { nodes } = buildTurnTimelineViewModel(firstCommitDocument);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    const replyIndex = nodes.findIndex((node) => node.uuid === "reply-1");
    // assert the reply row is listed as contributing.
    assert.ok(findContributingNodeIndexes(nodes, commitIndex!).includes(replyIndex));
});
