// Picks the surviving conversation head, redirecting to the working-tree owner's head when needed.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import {
  collectAncestorUuids,
  collectHeadUuids,
  findHeadAtOrAbove,
} from "./reconstruction_tree.ts";
import { findWorkingTreeOwner } from "./reconstruction_worktree.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { selectBranchRecords } from "./reconstruction_branch_records.ts";

// S14: skip owner-redirect when the final-head branch has its own file events.
function containsSurvivingBranchFileChange(
  records: TranscriptRecord[],
  finalHead: Uuid,
): boolean {
  return extractFileEvents(selectBranchRecords(records, finalHead)).length > 0;
}

// Picks the working-tree-owning head when a rewind left it off the final head's chain.
export function findSurvivingHead(records: TranscriptRecord[]): Uuid | undefined {
  const heads = collectHeadUuids(records);
  if (heads.length === 0) {
    return undefined;
  }
  const finalHead = heads[heads.length - 1]!;
  const owner = findWorkingTreeOwner(records);
  if (owner === undefined) {
    return finalHead;
  }
  const finalChain = collectAncestorUuids(records, finalHead);
  const ownerKey = owner.toString();
  const isOwnerInFinalChain = finalChain.has(ownerKey);
  if (isOwnerInFinalChain) {
    return finalHead;
  }
  const workingTreeHead = findHeadAtOrAbove(records, owner);
  if (workingTreeHead === undefined) {
    return finalHead;
  }
  const finalHeadHasFileChange = containsSurvivingBranchFileChange(records, finalHead);
  if (finalHeadHasFileChange) {
    return finalHead;
  }
  return workingTreeHead;
}
