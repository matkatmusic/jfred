// Builds the rewound and surviving branch wrappers of the conversation graph (spec 40).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import { BranchRole } from "./structures/vocabulary_views.ts";
import { selectLiveBranch, type ConversationBranch } from "./reconstruction_branch.ts";
import { selectBranchRecords } from "./reconstruction_branch_records.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import { convertRecordsToGraphTurns } from "./reconstruction_graph_turns.ts";
import type { ConvoBranch } from "./reconstruction_graph.ts";

export type SplitBranches = {
  surviving: ConversationBranch | undefined;
  rewound: ConversationBranch[];
};

export function splitSurvivingBranch(branches: ConversationBranch[]): SplitBranches {
  let surviving: ConversationBranch | undefined;
  const rewound: ConversationBranch[] = [];
  for (const branch of branches) {
    if (!branch.isSurviving) {
      rewound.push(branch);
    }
    else if (surviving === undefined) {
      surviving = branch;
    }
  }
  return { surviving, rewound };
}

export function selectRecordsOutsideUuids(
  records: TranscriptRecord[],
  excludedUuids: Set<string>,
): TranscriptRecord[] {
  const kept: TranscriptRecord[] = [];
  for (const record of records) {
    if (record.uuid === undefined) {
      continue;
    }
    const isExcluded = excludedUuids.has(record.uuid.toString());
    if (!isExcluded) {
      kept.push(record);
    }
  }
  return kept;
}

// Diverging records are on the tip's chain but not the surviving chain.
function buildRewoundConvoBranch(
  records: TranscriptRecord[],
  branch: ConversationBranch,
  survivingUuids: Set<string>,
  letters: Map<string, string>,
  accepted: Set<string>,
): ConvoBranch {
  const branchRecords = selectBranchRecords(records, branch.tip);
  const diverging = selectRecordsOutsideUuids(branchRecords, survivingUuids);
  const turns = convertRecordsToGraphTurns(diverging, accepted, letters);
  return { role: BranchRole.rewound, tip: branch.tip, rewindPoint: branch.rewindPoint, turns };
}

// Rewound branches that changed no files are dropped.
export function buildRewoundConvoBranches(
  records: TranscriptRecord[],
  rewoundBranches: ConversationBranch[],
  survivingUuids: Set<string>,
  letters: Map<string, string>,
  accepted: Set<string>,
): ConvoBranch[] {
  const kept: ConvoBranch[] = [];
  for (const branch of rewoundBranches) {
    const convoBranch = buildRewoundConvoBranch(records, branch, survivingUuids, letters, accepted);
    if (convoBranch.turns.length > 0) {
      kept.push(convoBranch);
    }
  }
  return kept;
}

// With a fork, drop shared trunk so only post-rewind turns remain.
function selectPostForkRecords(
  records: TranscriptRecord[],
  branchRecords: TranscriptRecord[],
  rewound: ConvoBranch[],
): TranscriptRecord[] {
  const forkPoint = rewound[0]?.rewindPoint;
  if (forkPoint === undefined) {
    return branchRecords;
  }
  const forkUuids = collectAncestorUuids(records, forkPoint);
  return selectRecordsOutsideUuids(branchRecords, forkUuids);
}

// Returns undefined when the branch changed no files, so the assembly drops it.
export function buildSurvivingConvoBranch(
  records: TranscriptRecord[],
  survivingBranch: ConversationBranch | undefined,
  rewound: ConvoBranch[],
  rootUuid: Uuid | undefined,
  letters: Map<string, string>,
  accepted: Set<string>,
): ConvoBranch | undefined {
  const branchRecords = survivingBranch
    ? selectBranchRecords(records, survivingBranch.tip)
    : selectLiveBranch(records);
  const postFork = selectPostForkRecords(records, branchRecords, rewound);
  const turns = convertRecordsToGraphTurns(postFork, accepted, letters);
  if (turns.length > 0) {
    const tip = survivingBranch?.tip ?? rootUuid ?? turns[turns.length - 1]!.changeId;
    return { role: BranchRole.surviving, tip, rewindPoint: undefined, turns };
  }
  // A file-less surviving branch is kept only when a rewound branch exists (S13).
  if (rewound.length === 0) {
    return undefined;
  }
  const tip = survivingBranch?.tip ?? rootUuid;
  if (tip === undefined) {
    return undefined;
  }
  return { role: BranchRole.surviving, tip, rewindPoint: undefined, turns: [] };
}
