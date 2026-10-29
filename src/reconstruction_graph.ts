// Two-DAG model: conversationDAG forks at rewinds, fileDAG is per-file lineage (spec 40).

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { BranchRole } from "./structures/vocabulary_views.ts";
import {
  collectAcceptedUserEditIds,
  extractRenderableEvents,
} from "./reconstruction_renderable.ts";
import { collectSurvivingUuids, findConversationBranches } from "./reconstruction_branch.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { convertEventToGraphTurn, formatColumnLabel } from "./reconstruction_graph_turns.ts";
import {
  buildRewoundConvoBranches,
  buildSurvivingConvoBranch,
  splitSurvivingBranch,
} from "./reconstruction_graph_branches.ts";
import { buildDagFromBranches, findConversationRootUuid } from "./reconstruction_graph_dag.ts";

// Topology only: file content stays in the content views.
export type GraphTurn = {
  letter: string;
  kind: EventKind;
  target: Path;
  changeId: Uuid;
  timestamp: Date;
};

// `rewindPoint` is undefined for the surviving branch; `turns` come after the fork.
export type ConvoBranch = {
  role: BranchRole;
  tip: Uuid;
  rewindPoint: Uuid | undefined;
  turns: GraphTurn[];
};

// A linear trunk with no fork; branch wrappers when a rewind changed files on more branches.
export type ConversationDag = {
  rootLetter: string;
  rootUuid: Uuid | undefined;
  trunk: GraphTurn[];
  branches: ConvoBranch[];
};

// One file's disk lineage: every version-ordered turn that touched it, across all branches.
export type FileDagEntry = { target: Path; turns: GraphTurn[] };

export type FileDag = { files: FileDagEntry[] };

// The single source of letters for both graphs; `accepted` drops disk-echo edits.
function getTurnLetters(records: TranscriptRecord[], accepted?: Set<string>): Map<string, string> {
  const letters = new Map<string, string>();
  let index = 0;
  for (const event of extractRenderableEvents(records, accepted)) {
    index += 1;
    letters.set(event.changeId.toString(), formatColumnLabel(index));
  }
  return letters;
}

export { getTurnLetters as assignTurnLetters };

// True cross-branch disk lineage (decision 9); events are already timestamp-sorted.
export function buildFileDag(records: TranscriptRecord[], reader?: BackupReader): FileDag {
  const accepted = collectAcceptedUserEditIds(records, reader);
  const letters = getTurnLetters(records, accepted);
  const groups = new Map<string, GraphTurn[]>();
  for (const event of extractRenderableEvents(records, accepted)) {
    const turn = convertEventToGraphTurn(event, letters);
    const key = turn.target.toString();
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }
  const files: FileDagEntry[] = [];
  for (const [key, turns] of groups) {
    files.push({ target: new Path(key), turns });
  }
  return { files };
}

// Only branches that changed files are kept.
export function buildConversationDag(records: TranscriptRecord[], reader?: BackupReader): ConversationDag {
  const accepted = collectAcceptedUserEditIds(records, reader);
  const letters = getTurnLetters(records, accepted);
  const branches = findConversationBranches(records);
  const survivingUuids = collectSurvivingUuids(records);
  const split = splitSurvivingBranch(branches);
  const rewound = buildRewoundConvoBranches(records, split.rewound, survivingUuids, letters, accepted);
  const rootUuid = findConversationRootUuid(records, rewound);
  const surviving = buildSurvivingConvoBranch(records, split.surviving, rewound, rootUuid, letters, accepted);
  const kept = surviving === undefined ? rewound : [surviving, ...rewound];
  return buildDagFromBranches(rootUuid, kept);
}
