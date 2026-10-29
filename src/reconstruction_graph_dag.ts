// Roots and assembles the conversation graph from its kept branches (spec 40).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import type { ConversationDag, ConvoBranch } from "./reconstruction_graph.ts";

const ROOT_LETTER = "A";

// Undefined for an unrooted or meta-only record set.
function findRootUuid(records: TranscriptRecord[]): Uuid | undefined {
  for (const record of records) {
    const isRoot = record.parentUuid === null || record.parentUuid === undefined;
    if (!isRoot) {
      continue;
    }
    if (record.uuid !== undefined) {
      return record.uuid;
    }
  }
  return undefined;
}

// Turns hang off where the branches diverge, so a forked history roots at the rewind point.
export function findConversationRootUuid(
  records: TranscriptRecord[],
  rewound: ConvoBranch[],
): Uuid | undefined {
  return rewound[0]?.rewindPoint ?? findRootUuid(records);
}

// A file-less branch has no turn time, so it sorts last.
function getFirstTurnTime(branch: ConvoBranch): number {
  if (branch.turns.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return branch.turns[0]!.timestamp.getTime();
}

function compareBranchesByFirstTurn(a: ConvoBranch, b: ConvoBranch): number {
  return getFirstTurnTime(a) - getFirstTurnTime(b);
}

// One remaining branch becomes a linear trunk; two or more become wrappers, oldest-first.
export function buildDagFromBranches(rootUuid: Uuid | undefined, kept: ConvoBranch[]): ConversationDag {
  if (kept.length <= 1) {
    return { rootLetter: ROOT_LETTER, rootUuid, trunk: kept[0]?.turns ?? [], branches: [] };
  }
  const ordered = [...kept].sort(compareBranchesByFirstTurn);
  return { rootLetter: ROOT_LETTER, rootUuid, trunk: [], branches: ordered };
}
