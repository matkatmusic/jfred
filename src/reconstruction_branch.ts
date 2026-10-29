// Conversation-branch model: rewind forks, surviving vs abandoned head selection, branch record filtering.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import { findSurvivingHead } from "./reconstruction_surviving_head.ts";
import {
  collectAbandonedHeads,
  collectSurvivingTrunkUuids,
  findRewindPoint,
} from "./reconstruction_trunk.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { findStructuralRewoundBranches } from "./reconstruction_fork.ts";
import { findForkedSubagentBranches } from "./reconstruction_fork_graft.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";

// A parentUuid-tree branch named by its tip; surviving if final, rewound if abandoned.
export type ConversationBranch = {
  tip: Uuid;
  rewindPoint: Uuid | undefined;
  isSurviving: boolean;
};

// Returns surviving + rewound branches; empty when no surviving head exists.
export function findConversationBranches(
  records: TranscriptRecord[],
): ConversationBranch[] {
  reportReconstructionProgress("locating surviving head");
  const survivingHead = findSurvivingHead(records);
  if (survivingHead === undefined) {
    return [];
  }
  reportReconstructionProgress("collecting surviving trunk uuids");
  const survivingSet = collectSurvivingTrunkUuids(records, survivingHead);
  const branches: ConversationBranch[] = [
    { tip: survivingHead, rewindPoint: undefined, isSurviving: true },
  ];
  reportReconstructionProgress("collecting abandoned heads");
  const abandonedTips = collectAbandonedHeads(records, survivingSet);
  for (const [tipIndex, tip] of abandonedTips.entries()) {
    // task 163: report per-tip progress so the branch-construction stage shows motion.
    reportReconstructionProgress("scanning branch tips", tipIndex + 1, abandonedTips.length);
    const rewindPoint = findRewindPoint(records, tip, survivingSet);
    branches.push({ tip, rewindPoint, isSurviving: false });
  }
  const existingTips = new Set<string>();
  for (const branch of branches) {
    existingTips.add(branch.tip.toString());
  }
  reportReconstructionProgress("scanning structural forks");
  branches.push(...findStructuralRewoundBranches(records, existingTips));
  const claimedTips = new Set<string>();
  for (const branch of branches) {
    claimedTips.add(branch.tip.toString());
  }
  branches.push(...findForkedSubagentBranches(records, claimedTips));
  return branches;
}

// Live-branch selections memoized per records-array identity, for the same reason as
// branchSelections above: downstream memos key on the selected array's IDENTITY.
// corpus: moved to reconstruction_corpus.ts (item 14)
// const liveBranchSelections = new WeakMap<TranscriptRecord[], TranscriptRecord[]>();

// Surviving trunk records; falls back to all records when no last-prompt head exists.
export function selectLiveBranch(
  records: TranscriptRecord[],
): TranscriptRecord[] {
  const survivingHead = findSurvivingHead(records);
  if (survivingHead === undefined) {
    // No surviving head: fall back to all records WITHOUT caching (the corpus's liveBranch stays undefined = not cached).
    return records;
  }
  // corpus: moved to reconstruction_corpus.ts (item 14)
  // const cached = liveBranchSelections.get(records);
  const state = getCorpusState(records);
  const cached = state.liveBranch;
  if (cached !== undefined) {
    return cached;
  }
  const trunkUuids = collectSurvivingTrunkUuids(records, survivingHead);
  let selected: TranscriptRecord[] = [];
  for (const record of records) {
    const uuidText = record.uuid?.toString();
    const isUnkeyed = uuidText === undefined;
    const isOnTrunk = uuidText !== undefined && trunkUuids.has(uuidText);
    const isKept = isUnkeyed || isOnTrunk;
    if (isKept) {
      selected.push(record);
    }
  }
  // Nothing dropped: keep the input's identity so downstream identity-keyed memos hit.
  if (selected.length === records.length) {
    selected = records;
  }
  // corpus: moved to reconstruction_corpus.ts (item 14)
  // liveBranchSelections.set(records, selected);
  state.liveBranch = selected;
  return selected;
}

// Surviving trunk uuid strings across all session trees; empty without a surviving head.
export function collectSurvivingUuids(
  records: TranscriptRecord[],
): Set<string> {
  const survivingHead = findSurvivingHead(records);
  if (survivingHead === undefined) {
    return new Set<string>();
  }
  return collectSurvivingTrunkUuids(records, survivingHead);
}

