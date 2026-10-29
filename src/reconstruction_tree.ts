// Conversation-tree walkers over the parentUuid forest and last-prompt heads. See plans/s8/s8-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getLastPromptEntry } from "./structures/session-meta.ts";
import { Uuid } from "./structures/domain.ts";

// Index the records that carry a uuid by that uuid string, for ancestor-chain walks.
export function buildRecordIndexByUuid(
  records: TranscriptRecord[],
): Map<string, TranscriptRecord> {
  const byUuid = new Map<string, TranscriptRecord>();
  for (const record of records) {
    if (record.uuid !== undefined) {
      byUuid.set(record.uuid.toString(), record);
    }
  }
  return byUuid;
}

// In file order, the leafUuid of each last-prompt record: the conversation heads.
export function collectHeadUuids(records: TranscriptRecord[]): Uuid[] {
  const heads: Uuid[] = [];
  for (const record of records) {
    const entry = getLastPromptEntry(record);
    if (entry !== undefined) {
      heads.push(entry.leafUuid);
    }
  }
  return heads;
}

// The uuid strings on `tip`'s ancestor chain, including the tip. Empty when the tip has no record.
export function collectAncestorUuids(
  records: TranscriptRecord[],
  tip: Uuid,
): Set<string> {
  const byUuid = buildRecordIndexByUuid(records);
  const ancestors = new Set<string>();
  let current = byUuid.get(tip.toString());
  while (current !== undefined) {
    const key = current.uuid!.toString();
    const isRepeated = ancestors.has(key);
    if (isRepeated) {
      break;
    }
    ancestors.add(key);
    const parent = current.parentUuid;
    if (parent === undefined) {
      break;
    }
    if (parent === null) {
      break;
    }
    current = byUuid.get(parent.toString());
  }
  return ancestors;
}

// The first last-prompt head at or above `start`, walking up by parentUuid. undefined when none.
export function findHeadAtOrAbove(
  records: TranscriptRecord[],
  start: Uuid,
): Uuid | undefined {
  const headKeys = new Set<string>();
  for (const head of collectHeadUuids(records)) {
    headKeys.add(head.toString());
  }
  const byUuid = buildRecordIndexByUuid(records);
  const visited = new Set<string>();
  let current = byUuid.get(start.toString());
  while (current !== undefined) {
    const key = current.uuid!.toString();
    const isRepeated = visited.has(key);
    if (isRepeated) {
      break;
    }
    visited.add(key);
    const isHead = headKeys.has(key);
    if (isHead) {
      return current.uuid;
    }
    const parent = current.parentUuid;
    if (parent === undefined) {
      break;
    }
    if (parent === null) {
      break;
    }
    current = byUuid.get(parent.toString());
  }
  return undefined;
}
