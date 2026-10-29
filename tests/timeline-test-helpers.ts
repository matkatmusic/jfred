// Shared fixtures for the timeline view-model tests, in the client's wire shape (JSON round-trip).

import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { Path } from "../src/structures/domain.ts";
import {
  RecordType,
  EventKind,
} from "../src/structures/vocabulary.ts";
import { GitOperationKind } from "../src/structures/vocabulary_views.ts";
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

// s39's git-baseline seed session alone, found by its session id prefix.
function findSeedJsonlPath(paths: Path[], sessionPrefix: string): Path {
  let seedPath: Path | undefined;
  for (const path of paths) {
    const pathText = path.toString();
    const isSeedPath = pathText.includes(sessionPrefix);
    if (isSeedPath) {
      seedPath = path;
      break;
    }
  }
  return seedPath!;
}

export const S39_SEED_JSONL_PATH = findSeedJsonlPath(S39_JSONL_PATHS, "b9783f4b");

export const s39SeedDocument = JSON.parse(JSON.stringify(buildProjectDocument([S39_SEED_JSONL_PATH], undefined)));

// Commit walk-back fixture: surviving replies, two adjacent orphaned replies, then two commits.

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
  const indexes: number[] = [];
  for (let index = 0; index < nodes.length; index++) {
    if (nodes[index]!.kind === COMMIT_NODE_KIND) {
      indexes.push(index);
    }
  }
  return indexes;
}

