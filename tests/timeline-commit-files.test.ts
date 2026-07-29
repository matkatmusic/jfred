// deriveCommitChangedFiles / findContributingNodeIndexes over a commit-walk document — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

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
import {
    commitWalkDocument,
    findCommitNodeIndexes,
} from "./timeline-test-helpers.ts";

test("test_deriveCommitChangedFiles_unions_files_since_previous_commit", () => {
    // Scenario: a commit's changed-file list is the union of every file change on the surviving rows between it and the previous commit (or the timeline start) — the mockup's findContributingRows data.  Steps: build the commit-walk timeline and take the FIRST commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert its changed files union alpha.py and beta.py (the two surviving replies before it).
    const changes = deriveCommitChangedFiles(nodes, firstCommitIndex!);
    assert.deepEqual(changes.map((change) => change.path).sort(), ["alpha.py", "beta.py"]);
});

test("test_deriveCommitChangedFiles_stops_at_previous_commit", () => {
    // Scenario: the walk back from a commit stops at the previous commit EXCLUSIVE — files committed earlier never leak into the later commit's list.  Steps: build the commit-walk timeline and take the SECOND commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const commitIndexes = findCommitNodeIndexes(nodes);
    const changes = deriveCommitChangedFiles(nodes, commitIndexes[1]!);
    // assert only replyD's alpha.py revision (after commit #1) is listed — via its changeId.
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.path, "alpha.py");
    assert.equal(changes[0]!.changeId, "change-alpha-2");
});

test("test_deriveCommitChangedFiles_skips_orphaned_nodes", () => {
    // Scenario: orphaned (rewound-branch) rows never contribute to a commit's changed files — their edits were rewound before the commit happened.  Steps: build the commit-walk timeline and take the first commit (the orphans sit just before it).
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert neither rewound-branch file appears.
    const paths = deriveCommitChangedFiles(nodes, firstCommitIndex!).map((change) => change.path);
    assert.ok(!paths.includes("gamma.py"));
    assert.ok(!paths.includes("delta.py"));
});

test("test_deriveCommitChangedFiles_dedupes_paths_keeping_latest", () => {
    // Scenario: when two rows before one commit touch the SAME path, the commit lists the path once, keeping the occurrence closest to the commit (the latest revision).  Steps: build a minimal document: two replies each revising alpha.py, then one commit.
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
    const changes = deriveCommitChangedFiles(nodes, commitIndex!);
    // assert alpha.py appears exactly once, carrying the LATER revision's changeId.
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.path, "alpha.py");
    assert.equal(changes[0]!.changeId, "change-a2");
});

test("test_findContributingNodeIndexes_marks_nodes_touching_commit_files", () => {
    // Scenario: selecting a commit highlights every surviving row (since the previous commit) whose file changes overlap the commit's changed files — the mockup's `.contrib` rows.  Steps: build the commit-walk timeline and take the first commit.
    const { nodes } = buildTurnTimelineViewModel(commitWalkDocument);
    const [firstCommitIndex] = findCommitNodeIndexes(nodes);
    // assert exactly replyA (index 1) and replyB (index 2) contribute — never the prompt or the orphaned replies.
    assert.deepEqual(findContributingNodeIndexes(nodes, firstCommitIndex!), [1, 2]);
});

test("test_findContributingNodeIndexes_returns_empty_for_no_overlap", () => {
    // Scenario: a commit preceded by rows that changed no files highlights nothing.  Steps: build a minimal document: prompt, snapshot-less reply, then a commit.
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
