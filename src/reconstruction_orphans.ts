// Orphaned-record detection: uuids on rewound branches, skipping tool-plumbing micro-forks.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import {
  collectAncestorUuids,
  indexRecordsByUuid,
} from "./reconstruction_tree.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { containsAssistantText } from "./reconstruction_assistant_text.ts";
import {
  collectSurvivingUuids,
  findConversationBranches,
} from "./reconstruction_branch.ts";

// Ancestor-chain uuids of the tip that are not on the surviving trunk.
function collectBranchExclusiveUuids(
  records: TranscriptRecord[],
  tip: Uuid,
  surviving: Set<string>,
): Set<string> {
  const exclusive = new Set<string>();
  for (const uuid of collectAncestorUuids(records, tip)) {
    const isOnTrunk = surviving.has(uuid);
    if (!isOnTrunk) {
      exclusive.add(uuid);
    }
  }
  return exclusive;
}

export function collectOrphanedUuids(records: TranscriptRecord[]): Set<string> {
  const branches = findConversationBranches(records);
  const rewoundTips = [];
  for (const branch of branches) {
    if (!branch.isSurviving) {
      rewoundTips.push(branch);
    }
  }
  if (rewoundTips.length === 0) {
    return new Set<string>();
  }
  const surviving = collectSurvivingUuids(records);
  const byUuid = indexRecordsByUuid(records);
  const abandoned = new Set<string>();
  for (const branch of rewoundTips) {
    const exclusive = collectBranchExclusiveUuids(records, branch.tip, surviving);
    const isPlumbing = isBranchToolPlumbing(records, byUuid, surviving, exclusive);
    if (isPlumbing) {
      continue;
    }
    for (const uuid of exclusive) {
      abandoned.add(uuid);
    }
  }
  if (abandoned.size === 0) {
    return abandoned;
  }
  const orphaned = new Set<string>();
  // ponytail: uncached walk is O(records x depth); memoize if a large project measures slow.
  for (const record of records) {
    if (record.uuid === undefined) {
      continue;
    }
    const isOrphan = isChainReachingAbandoned(record, byUuid, surviving, abandoned);
    if (isOrphan) {
      orphaned.add(record.uuid.toString());
    }
  }
  return orphaned;
}

// True when parentUuid chain hits abandoned set before the surviving trunk.
function isChainReachingAbandoned(
  record: TranscriptRecord,
  byUuid: Map<string, TranscriptRecord>,
  surviving: Set<string>,
  abandoned: Set<string>,
): boolean {
  const visited = new Set<string>();
  let current: TranscriptRecord | undefined = record;
  while (current !== undefined) {
    if (current.uuid === undefined) {
      return false;
    }
    const key = current.uuid.toString();
    const isRevisit = visited.has(key);
    if (isRevisit) {
      return false;
    }
    visited.add(key);
    const isAbandoned = abandoned.has(key);
    if (isAbandoned) {
      return true;
    }
    const isOnTrunk = surviving.has(key);
    if (isOnTrunk) {
      return false;
    }
    const parent = current.parentUuid;
    const hasParent = parent !== undefined && parent !== null;
    if (!hasParent) {
      return false;
    }
    current = byUuid.get(parent.toString());
  }
  return false;
}

// True when branch holds only tool plumbing (hook command rewrites), not a /rewind.
function isBranchToolPlumbing(
  records: TranscriptRecord[],
  byUuid: Map<string, TranscriptRecord>,
  surviving: Set<string>,
  exclusive: Set<string>,
): boolean {
  for (const record of records) {
    if (record.uuid === undefined) {
      continue;
    }
    const isOnBranch = isChainReachingAbandoned(record, byUuid, surviving, exclusive);
    if (!isOnBranch) {
      continue;
    }
    const isPrompt = isGenuineUserPrompt(record);
    if (isPrompt) {
      return false;
    }
    const hasText = containsAssistantText(record);
    if (hasText) {
      return false;
    }
  }
  return true;
}
