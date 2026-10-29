// Downward walkers over the parentUuid forest, split from reconstruction_tree.ts.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { RecordType } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";
import { buildRecordIndexByUuid } from "./reconstruction_tree.ts";

// Index records by parentUuid string: every record's children, for downward forest walks.
function buildChildrenByParent(
  records: TranscriptRecord[],
): Map<string, TranscriptRecord[]> {
  const byParent = new Map<string, TranscriptRecord[]>();
  for (const record of records) {
    const parent = record.parentUuid;
    if (parent === undefined) {
      continue;
    }
    if (parent === null) {
      continue;
    }
    const key = parent.toString();
    const siblings = byParent.get(key);
    if (siblings === undefined) {
      byParent.set(key, [record]);
      continue;
    }
    siblings.push(record);
  }
  return byParent;
}

// Uuid strings of all descendants of `start` (not `start`), through every record type. See plans/s13/.
export function collectDescendantUuids(
  records: TranscriptRecord[],
  start: Uuid,
): Set<string> {
  const byParent = buildChildrenByParent(records);
  const descendants = new Set<string>();
  const queue: string[] = [start.toString()];
  while (queue.length > 0) {
    const parentKey = queue.shift()!;
    const fresh = addNewChildren(byParent.get(parentKey) ?? [], descendants);
    queue.push(...fresh);
  }
  return descendants;
}

// Add each unseen child's uuid to `descendants`; return only the freshly added uuid strings.
function addNewChildren(
  siblings: TranscriptRecord[],
  descendants: Set<string>,
): string[] {
  const fresh: string[] = [];
  for (const child of siblings) {
    const childKey = child.uuid!.toString();
    const isSeen = descendants.has(childKey);
    if (!isSeen) {
      descendants.add(childKey);
      fresh.push(childKey);
    }
  }
  return fresh;
}

// The latest-timestamp user or assistant descendant of `start`: the abandoned branch's tip. undefined when none.
export function findDeepestPromptOrReply(
  records: TranscriptRecord[],
  start: Uuid,
): Uuid | undefined {
  const descendants = collectDescendantUuids(records, start);
  const byUuid = buildRecordIndexByUuid(records);
  let deepest: TranscriptRecord | undefined = undefined;
  for (const key of descendants) {
    const record = byUuid.get(key);
    if (record === undefined) {
      continue;
    }
    const isTurn = isConversationalTurn(record);
    if (!isTurn) {
      continue;
    }
    const isLater = isLaterThan(record, deepest);
    if (isLater) {
      deepest = record;
    }
  }
  return deepest?.uuid;
}

// True when `record` is a user or assistant turn, the record types that can name a tip.
function isConversationalTurn(record: TranscriptRecord): boolean {
  if (record.type === RecordType.user) {
    return true;
  }
  if (record.type === RecordType.assistant) {
    return true;
  }
  return false;
}

// True when `candidate` has a strictly later timestamp than `incumbent` (any candidate beats none).
function isLaterThan(
  candidate: TranscriptRecord,
  incumbent: TranscriptRecord | undefined,
): boolean {
  if (incumbent === undefined) {
    return true;
  }
  const candidateTime = candidate.timestamp?.getTime() ?? 0;
  const incumbentTime = incumbent.timestamp?.getTime() ?? 0;
  return candidateTime > incumbentTime;
}
