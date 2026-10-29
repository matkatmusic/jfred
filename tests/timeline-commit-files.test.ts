// computeCommitChangedFiles / findContributingNodeIndexes over a commit-walk document — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

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
import {
    commitWalkDocument,
    findCommitNodeIndexes,
} from "./timeline-test-helpers.ts";

test("test_computeCommitChangedFiles_unions_files_since_previous_commit", () => {
    // Scenario: a commit lists the union of file changes since the previous commit. Steps: take the FIRST commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert its changed files union alpha.py and beta.py (the two surviving replies before it).
    const changes = computeCommitChangedFiles(nodes, firstCommitIndex!);
    assert.deepEqual(changes.map((change) => change.path).sort(), ["alpha.py", "beta.py"]);
});

test("test_computeCommitChangedFiles_stops_at_previous_commit", () => {
    // Scenario: the walk back stops at the previous commit EXCLUSIVE. Steps: take the SECOND commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const commitIndexes = findCommitNodeIndexes(nodes);
    const changes = computeCommitChangedFiles(nodes, commitIndexes[1]!);
    // assert only replyD's alpha.py revision (after commit #1) is listed — via its changeId.
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.path, "alpha.py");
    assert.equal(changes[0]!.changeId, "change-alpha-2");
});

test("test_computeCommitChangedFiles_skips_orphaned_nodes", () => {
    // Scenario: orphaned (rewound-branch) rows never contribute changed files. Steps: take the first commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert neither rewound-branch file appears.
    const paths = computeCommitChangedFiles(nodes, firstCommitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("gamma.py"));
    assert.ok(!paths.includes("delta.py"));
});

test("test_computeCommitChangedFiles_dedupes_paths_keeping_latest", () => {
    // Scenario: two rows touch the SAME path; the commit lists it once, latest revision. Steps: two replies, one commit.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "edit alpha twice",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "wrote alpha",
        }, {
            uuid: "reply-2",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:20.000Z",
            text: "edited alpha",
        }],
        steps: [
            { index: 1, when: "2026-01-01T00:00:05.000Z", sessionId: "session-a", changeIds: ["change-a1"], changedPaths: [], files: {} },
            { index: 2, when: "2026-01-01T00:00:15.000Z", sessionId: "session-a", changeIds: ["change-a2"], changedPaths: [], files: {} },
        ],
        filesTouched: [{
            target: "alpha.py",
            revisions: [
                { kind: EventKind.write, changeId: "change-a1", timestamp: "2026-01-01T00:00:05.000Z" },
                { kind: EventKind.edit, changeId: "change-a2", timestamp: "2026-01-01T00:00:15.000Z" },
            ],
        }],
        rewoundFilesTouched: [],
        commitMarkers: [],
        gitOperations: [{
            kind: GitOperationKind.commit,
            detail: "both edits",
            command: 'git commit -m "both edits"',
            timestamp: "2026-01-01T00:00:30.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    const changes = computeCommitChangedFiles(nodes, commitIndex!);
    // assert alpha.py appears exactly once, carrying the LATER revision's changeId.
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.path, "alpha.py");
    assert.equal(changes[0]!.changeId, "change-a2");
});

test("test_findContributingNodeIndexes_marks_nodes_touching_commit_files", () => {
    // Scenario: selecting a commit highlights each row whose file changes overlap its files. Steps: take the first commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert exactly replyA (index 1) and replyB (index 2) contribute — never the prompt or the orphaned replies.
    assert.deepEqual(findContributingNodeIndexes(nodes, firstCommitIndex!), [1, 2]);
});

test("test_findContributingNodeIndexes_returns_empty_for_no_overlap", () => {
    // Scenario: a commit after rows with no file changes highlights nothing. Steps: prompt, bare reply, commit.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "just commit",
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
            detail: "empty",
            command: 'git commit -m "empty"',
            timestamp: "2026-01-01T00:00:20.000Z",
            sessionId: "session-a",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const [commitIndex] = findCommitNodeIndexes(nodes);
    // assert no row contributes.
    assert.deepEqual(findContributingNodeIndexes(nodes, commitIndex!), []);
});
