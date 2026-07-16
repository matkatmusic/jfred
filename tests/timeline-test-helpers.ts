// Shared fixtures for the timeline view-model test files (split from timeline-viewmodels.test.ts).
// Every test feeds the client's wire shape — JSON.parse(JSON.stringify(document)) — exactly what
// the browser sees after fetch. Role/kind assertions go through the vocabulary enum members
// (their values ARE the wire strings), never bare literals.

import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { Path } from "../src/structures/domain.ts";
import {
    RecordType,
    EventKind,
    GitOperationKind,
} from "../src/structures/vocabulary.ts";
import {
    S2_JSONL,
    S45_JSONL,
    S39_JSONL_PATHS,
    S84_JSONL_PATHS,
    S85_JSONL_PATHS,
} from "./fixtures.ts";

export const s84Document = JSON.parse(JSON.stringify(buildProjectDocument(S84_JSONL_PATHS, undefined)));

export const s85Document = JSON.parse(JSON.stringify(buildProjectDocument(S85_JSONL_PATHS, undefined)));

export const s2Document = JSON.parse(JSON.stringify(buildProjectDocument([new Path(S2_JSONL)], undefined)));

export const s45Document = JSON.parse(JSON.stringify(buildProjectDocument([new Path(S45_JSONL)], undefined)));

// s39's git-baseline seed session alone (item 55): its tool calls and raw lines are known
// line-by-line (git init L32, ls L33, rtk-rewrite hook L39, mkdir L44, Writes L51/L55).

export const S39_SEED_JSONL_PATH = S39_JSONL_PATHS.find((path) => path.toString().includes("b9783f4b"))!;

export const s39SeedDocument = JSON.parse(JSON.stringify(buildProjectDocument([S39_SEED_JSONL_PATH], undefined)));

// Shared fixture for the commit walk-back helpers: two surviving replies (alpha.py, beta.py), two
// ADJACENT orphaned replies (gamma.py, delta.py live only on the rewound branch), a first commit,
// one more surviving reply (alpha.py's second revision), and a second commit. Sorted node order:
// [0 prompt, 1 replyA, 2 replyB, 3 replyO1, 4 replyO2, 5 commit#1, 6 replyD, 7 session-end,
// 8 commit#2].

export const commitWalkDocument = {
    messages: [{
        uuid: "prompt-1",
        role: RecordType.user,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:00.000Z",
        text: "edit files and commit twice",
    }, {
        uuid: "reply-a",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:10.000Z",
        text: "wrote alpha",
    }, {
        uuid: "reply-b",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:20.000Z",
        text: "wrote beta",
    }, {
        uuid: "reply-o1",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:30.000Z",
        text: "wrote gamma (later rewound)",
        // The engine stamps abandoned-branch membership on the wire; the view copies it.
        isOrphaned: true,
    }, {
        uuid: "reply-o2",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:32.000Z",
        text: "wrote delta (later rewound)",
        isOrphaned: true,
    }, {
        uuid: "reply-d",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:00:50.000Z",
        text: "edited alpha again",
    }],
    steps: [
        { index: 1, when: "2026-01-01T00:00:05.000Z", sessionId: "session-a", changeIds: ["change-alpha-1"], changedPaths: [], files: {} },
        { index: 2, when: "2026-01-01T00:00:15.000Z", sessionId: "session-a", changeIds: ["change-beta-1"], changedPaths: [], files: {} },
        { index: 3, when: "2026-01-01T00:00:25.000Z", sessionId: "session-a", changeIds: ["change-gamma-1"], changedPaths: [], files: {} },
        { index: 4, when: "2026-01-01T00:00:31.000Z", sessionId: "session-a", changeIds: ["change-delta-1"], changedPaths: [], files: {} },
        { index: 5, when: "2026-01-01T00:00:45.000Z", sessionId: "session-a", changeIds: ["change-alpha-2"], changedPaths: [], files: {} },
    ],
    filesTouched: [{
        target: "alpha.py",
        revisions: [
            { kind: EventKind.write, changeId: "change-alpha-1", timestamp: "2026-01-01T00:00:05.000Z" },
            { kind: EventKind.edit, changeId: "change-alpha-2", timestamp: "2026-01-01T00:00:45.000Z" },
        ],
    }, {
        target: "beta.py",
        revisions: [{ kind: EventKind.write, changeId: "change-beta-1", timestamp: "2026-01-01T00:00:15.000Z" }],
    }],
    rewoundFilesTouched: [{
        target: "gamma.py",
        revisions: [{ kind: EventKind.write, changeId: "change-gamma-1", timestamp: "2026-01-01T00:00:25.000Z" }],
    }, {
        target: "delta.py",
        revisions: [{ kind: EventKind.write, changeId: "change-delta-1", timestamp: "2026-01-01T00:00:31.000Z" }],
    }],
    commitMarkers: [],
    gitOperations: [{
        kind: GitOperationKind.commit,
        detail: "first",
        command: 'git commit -m "first"',
        timestamp: "2026-01-01T00:00:35.000Z",
        sessionId: "session-a",
    }, {
        kind: GitOperationKind.commit,
        detail: "second",
        command: 'git commit -m "second"',
        timestamp: "2026-01-01T00:00:55.000Z",
        sessionId: "session-a",
    }],
};

// The indexes of a timeline's commit nodes, in order.

export function findCommitNodeIndexes(nodes: { kind: string }[]): number[] {
    return nodes.flatMap((node, index) => (node.kind === COMMIT_NODE_KIND ? [index] : []));
}

// Minimal git-baseline document (task 86): one real turn pair, one gitBase-only step (no
// session), and one generic unattributed step (blob-ref style changeId resolving nowhere,
// changedPaths fallback) that must NOT merge into the baseline node.

export const gitBaselineDocument = {
    messages: [{
        uuid: "prompt-1",
        role: RecordType.user,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:10:00.000Z",
        text: "start working",
    }, {
        uuid: "reply-1",
        role: RecordType.assistant,
        sessionId: "session-a",
        timestamp: "2026-01-01T00:10:10.000Z",
        text: "working",
    }],
    steps: [
        { index: 1, when: "2026-01-01T00:00:00.000Z", sessionId: undefined, changeIds: ["gitBase:abc1234:orders.py"], changedPaths: [], files: {} },
        { index: 2, when: "2026-01-01T00:20:00.000Z", sessionId: undefined, changeIds: ["deadbeef00000000@v1"], changedPaths: ["notes.txt"], files: {} },
    ],
    filesTouched: [{
        target: "orders.py",
        revisions: [{ kind: EventKind.write, changeId: "gitBase:abc1234:orders.py", timestamp: "2026-01-01T00:00:00.000Z" }],
    }],
    rewoundFilesTouched: [],
    commitMarkers: [],
    gitOperations: [],
};
