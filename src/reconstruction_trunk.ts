// Surviving-trunk and abandoned-head helpers for the conversation-branch model in reconstruction_branch.ts.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import { addParallelToolCallSiblings } from "./reconstruction_trunk_absorb.ts";
import { buildHeadChains, filterUniqueUuids, isChainOverlapping, isMaximalTip } from "./reconstruction_trunk_heads.ts";
import {
  collectAncestorUuids,
  collectHeadUuids,
  buildRecordIndexByUuid,
} from "./reconstruction_tree.ts";

// Final head of each tree not holding the surviving head: predecessor sessions are surviving trunk, never rewinds.
function collectPredecessorFinalHeads(records: TranscriptRecord[], survivingHead: Uuid): Uuid[] {
  const heads = filterUniqueUuids(collectHeadUuids(records));
  const chains = buildHeadChains(records, heads);
  const survivingChain = chains.get(survivingHead.toString()) ?? collectAncestorUuids(records, survivingHead);
  const trees: { chainUnion: Set<string>; finalHead: Uuid }[] = [];
  for (const head of heads) {
    const chain = chains.get(head.toString())!;
    const chainReachesSurviving = isChainOverlapping(chain, survivingChain);
    if (chainReachesSurviving) {
      continue;
    }
    let tree: { chainUnion: Set<string>; finalHead: Uuid } | undefined;
    for (const entry of trees) {
      const entryOverlaps = isChainOverlapping(entry.chainUnion, chain);
      if (entryOverlaps) {
        tree = entry;
        break;
      }
    }
    if (tree === undefined) {
      trees.push({ chainUnion: new Set(chain), finalHead: head });
      continue;
    }
    for (const uuid of chain) {
      tree.chainUnion.add(uuid);
    }
    tree.finalHead = head;
  }
  const finalHeads: Uuid[] = [];
  for (const tree of trees) {
    finalHeads.push(tree.finalHead);
  }
  return finalHeads;
}

// Uuid strings of the surviving trunk across all session trees, absorbing same-turn parallel-tool-call siblings (task 145).
export function collectSurvivingTrunkUuids(records: TranscriptRecord[], survivingHead: Uuid): Set<string> {
  const trunk = collectAncestorUuids(records, survivingHead);
  for (const head of collectPredecessorFinalHeads(records, survivingHead)) {
    for (const uuid of collectAncestorUuids(records, head)) {
      trunk.add(uuid);
    }
  }
  addParallelToolCallSiblings(records, trunk);
  return trunk;
}


// Rewind point of an abandoned tip: first uuid on its path to the root that is in `survivingSet`.
export function findRewindPoint(
  records: TranscriptRecord[],
  tip: Uuid,
  survivingSet: Set<string>,
): Uuid | undefined {
  const byUuid = buildRecordIndexByUuid(records);
  const visited = new Set<string>();
  let current = byUuid.get(tip.toString());
  while (current !== undefined) {
    const key = current.uuid!.toString();
    const alreadyVisited = visited.has(key);
    if (alreadyVisited) {
      return undefined;
    }
    visited.add(key);
    const onSurvivingPath = survivingSet.has(key);
    if (onSurvivingPath) {
      return current.uuid;
    }
    const parent = current.parentUuid;
    if (parent === undefined) {
      return undefined;
    }
    if (parent === null) {
      return undefined;
    }
    current = byUuid.get(parent.toString());
  }
  return undefined;
}

// The abandoned heads: heads off the surviving chain, deduped to maximal tips.
export function collectAbandonedHeads(
  records: TranscriptRecord[],
  survivingSet: Set<string>,
): Uuid[] {
  const heads = filterUniqueUuids(collectHeadUuids(records));
  const abandoned: Uuid[] = [];
  for (const head of heads) {
    const headIsSurviving = survivingSet.has(head.toString());
    if (!headIsSurviving) {
      abandoned.push(head);
    }
  }
  const chains = buildHeadChains(records, abandoned);
  const maximalTips: Uuid[] = [];
  for (const head of abandoned) {
    const headIsMaximalTip = isMaximalTip(head, abandoned, chains);
    if (headIsMaximalTip) {
      maximalTips.push(head);
    }
  }
  return maximalTips;
}
