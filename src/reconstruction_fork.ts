// Discovers rewound branches via parentUuid forks that head-based scanning misses.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import type { ConversationBranch } from "./reconstruction_branch.ts";
import {
  collectDescendantUuids,
  findDeepestPromptOrReply,
} from "./reconstruction_descendants.ts";
import {
  findPromptForkPoints,
  isGenuineUserPrompt,
} from "./reconstruction_prompts.ts";

// Finds structural rewound branches not already represented by head-based tips.
export function findStructuralRewoundBranches(
  records: TranscriptRecord[],
  existingTips: Set<string>,
): ConversationBranch[] {
  const claimed = new Set<string>(existingTips);
  const found: ConversationBranch[] = [];
  const forkPoints = findPromptForkPoints(records);
  for (const [forkIndex, forkPoint] of forkPoints.entries()) {
    // task 163: report progress so structural-only transcripts still show motion.
    reportReconstructionProgress("scanning branch tips", forkIndex + 1, forkPoints.length);
    found.push(...collectRewoundBranchesAtFork(records, forkPoint, claimed));
  }
  return found;
}

// Collects abandoned branches at one fork, skipping the latest child (surviving side).
function collectRewoundBranchesAtFork(
  records: TranscriptRecord[],
  forkPoint: Uuid,
  claimed: Set<string>,
): ConversationBranch[] {
  const children = collectGenuinePromptChildren(records, forkPoint);
  if (children.length < 2) {
    return [];
  }
  const abandoned = children.slice(0, children.length - 1);
  const branches: ConversationBranch[] = [];
  for (const prompt of abandoned) {
    const branch = buildRewoundBranchForPrompt(records, forkPoint, prompt.uuid!, claimed);
    if (branch !== undefined) {
      branches.push(branch);
      claimed.add(branch.tip.toString());
    }
  }
  return branches;
}

// Returns the abandoned branch, or undefined if already claimed or no tip.
function buildRewoundBranchForPrompt(
  records: TranscriptRecord[],
  forkPoint: Uuid,
  abandonedPrompt: Uuid,
  claimed: Set<string>,
): ConversationBranch | undefined {
  const isSubtreeClaimed = containsClaimedTip(records, abandonedPrompt, claimed);
  if (isSubtreeClaimed) {
    return undefined;
  }
  const tip = findDeepestPromptOrReply(records, abandonedPrompt);
  if (tip === undefined) {
    return undefined;
  }
  const isTipClaimed = claimed.has(tip.toString());
  if (isTipClaimed) {
    return undefined;
  }
  return { tip, rewindPoint: forkPoint, isSurviving: false };
}

// The genuine-prompt children of `forkPoint`, ordered by timestamp ascending.
function collectGenuinePromptChildren(
  records: TranscriptRecord[],
  forkPoint: Uuid,
): TranscriptRecord[] {
  const children: TranscriptRecord[] = [];
  for (const record of records) {
    const isChild = isPromptChildOf(record, forkPoint);
    if (isChild) {
      children.push(record);
    }
  }
  return children.sort(compareByPromptTime);
}

function compareByPromptTime(left: TranscriptRecord, right: TranscriptRecord): number {
  return getPromptTime(left) - getPromptTime(right);
}

// True when `record` is a genuine user prompt whose parent is `forkPoint`.
function isPromptChildOf(record: TranscriptRecord, forkPoint: Uuid): boolean {
  const parent = record.parentUuid;
  if (parent === undefined) {
    return false;
  }
  if (parent === null) {
    return false;
  }
  const isForkChild = parent.toString() === forkPoint.toString();
  if (!isForkChild) {
    return false;
  }
  return isGenuineUserPrompt(record);
}

function getPromptTime(record: TranscriptRecord): number {
  return record.timestamp?.getTime() ?? 0;
}

// Dedup guard: skip subtrees already covered by head-based branch discovery.
function containsClaimedTip(
  records: TranscriptRecord[],
  abandonedPrompt: Uuid,
  claimed: Set<string>,
): boolean {
  const subtree = collectDescendantUuids(records, abandonedPrompt);
  for (const tip of claimed) {
    const isInSubtree = subtree.has(tip);
    if (isInSubtree) {
      return true;
    }
  }
  return false;
}

