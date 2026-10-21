// Head-chain helpers for reconstruction_trunk.ts, split out for the line cap.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";

// The ancestor-chain uuid set of every head, keyed by head uuid string; this loop is slow.
export function buildHeadChains(records: TranscriptRecord[], heads: Uuid[]): Map<string, Set<string>> {
  const chains = new Map<string, Set<string>>();
  for (const [headIndex, head] of heads.entries()) {
    reportReconstructionProgress("charting conversation heads", headIndex + 1, heads.length);
    chains.set(head.toString(), collectAncestorUuids(records, head));
  }
  return chains;
}

// True when the two chains share any uuid, so their heads share a conversation tree.
export function isChainOverlapping(a: Set<string>, b: Set<string>): boolean {
  for (const uuid of a) {
    const sharedUuid = b.has(uuid);
    if (sharedUuid) {
      return true;
    }
  }
  return false;
}

// Deduplicate uuids by their string value, preserving first-seen order.
export function filterUniqueUuids(uuids: Uuid[]): Uuid[] {
  const seen = new Set<string>();
  const unique: Uuid[] = [];
  for (const uuid of uuids) {
    const uuidIsNew = !seen.has(uuid.toString());
    if (uuidIsNew) {
      seen.add(uuid.toString());
      unique.push(uuid);
    }
  }
  return unique;
}

// True when the head is not an ancestor of any other abandoned head.
export function isMaximalTip(
  head: Uuid,
  abandoned: Uuid[],
  chains: Map<string, Set<string>>,
): boolean {
  for (const other of abandoned) {
    const otherIsHead = other.toString() === head.toString();
    if (otherIsHead) {
      continue;
    }
    const otherChain = chains.get(other.toString())!;
    const headIsOnOtherChain = otherChain.has(head.toString());
    if (headIsOnOtherChain) {
      return false;
    }
  }
  return true;
}
