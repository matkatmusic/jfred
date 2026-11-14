// Multi-source merging: dedupe, wall-clock interleave, per-session root resolution.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { PathOverrides, SourceEntry } from "./reconstruction_overrides.ts";
import { joinCrossSourceFileIdentities } from "./reconstruction_multi_source_join.ts";
import { getFileHistorySnapshot } from "./structures/file-history.ts";
import { getSessionId } from "./reconstruction_multi_source_paths.ts";
import { computeSessionRoots } from "./reconstruction_multi_source_roots.ts";
import { attachForkedSubagentRoots } from "./reconstruction_fork_graft.ts";

// The dedupe identity of one record, or undefined when it carries no (sessionId, uuid) pair.
function computeRecordIdentityKey(record: TranscriptRecord): string | undefined {
  const sessionId = getSessionId(record);
  const recordUuid = record.uuid;
  const isMissingIdentity = sessionId === undefined || recordUuid === undefined;
  if (isMissingIdentity) {
    return undefined;
  }
  return `${sessionId.toString()} ${recordUuid.toString()}`;
}

// True when the record is the first of its identity; records with no identity always count as first.
function isFirstOccurrence(record: TranscriptRecord, seen: Set<string>): boolean {
  const identityKey = computeRecordIdentityKey(record);
  if (identityKey === undefined) {
    return true;
  }
  const isDuplicate = seen.has(identityKey);
  if (isDuplicate) {
    return false;
  }
  seen.add(identityKey);
  return true;
}

// §c1: dedupe by (sessionId, uuid); first wins.
export function removeDuplicateRecordsBySessionAndUuid(
  records: TranscriptRecord[],
  seen: Set<string> = new Set<string>(),
): TranscriptRecord[] {
  const kept: TranscriptRecord[] = [];
  for (const record of records) {
    const isKept = isFirstOccurrence(record, seen);
    if (isKept) {
      kept.push(record);
    }
  }
  return kept;
}

function findFirstStampedKey(records: TranscriptRecord[]): number {
  for (const record of records) {
    if (record.timestamp !== undefined) {
      return record.timestamp.getTime();
    }
  }
  return Number.POSITIVE_INFINITY;
}

function computeCarriedKey(record: TranscriptRecord, carriedKey: number, overrideKey: number | undefined): number {
  if (overrideKey !== undefined) {
    return overrideKey;
  }
  if (record.timestamp !== undefined) {
    return record.timestamp.getTime();
  }
  const snapshotMessage = getFileHistorySnapshot(record);
  if (snapshotMessage !== undefined) {
    return Math.max(carriedKey, snapshotMessage.snapshot.timestamp.getTime());
  }
  return carriedKey;
}

// Sort key: own timestamp, else the later of carried-forward and own snapshot.timestamp, else first stamped.
function computeListSortKeys(records: TranscriptRecord[], sortTimeOverrides?: Map<TranscriptRecord, number>): number[] {
  let carriedKey = findFirstStampedKey(records);
  const sortKeys: number[] = [];
  for (const record of records) {
    carriedKey = computeCarriedKey(record, carriedKey, sortTimeOverrides?.get(record));
    sortKeys.push(carriedKey);
  }
  return sortKeys;
}

function computeAllListSortKeys(recordLists: TranscriptRecord[][], sortTimeOverrides?: Map<TranscriptRecord, number>): number[][] {
  const allSortKeys: number[][] = [];
  for (const list of recordLists) {
    allSortKeys.push(computeListSortKeys(list, sortTimeOverrides));
  }
  return allSortKeys;
}

function countRecordsInLists(recordLists: TranscriptRecord[][]): number {
  let totalCount = 0;
  for (const list of recordLists) {
    totalCount += list.length;
  }
  return totalCount;
}

// Pick the list with the smallest next sort key.
function selectEarliestList(recordLists: TranscriptRecord[][], sortKeys: number[][], positions: number[]): number {
  let chosenList = -1;
  for (let listIndex = 0; listIndex < recordLists.length; listIndex++) {
    if (positions[listIndex]! >= recordLists[listIndex]!.length) {
      continue;
    }
    const isEarlier =
      chosenList < 0 ||
      sortKeys[listIndex]![positions[listIndex]!]! < sortKeys[chosenList]![positions[chosenList]!]!;
    if (isEarlier) {
      chosenList = listIndex;
    }
  }
  return chosenList;
}

// §c3 — strict wall-clock interleave of per-session record lists, each list's internal order preserved.
export function mergeRecordsByTimestamp(recordLists: TranscriptRecord[][], sortTimeOverrides?: Map<TranscriptRecord, number>): TranscriptRecord[] {
  const sortKeys = computeAllListSortKeys(recordLists, sortTimeOverrides);
  const positions = new Array<number>(recordLists.length).fill(0);
  const totalCount = countRecordsInLists(recordLists);
  const merged: TranscriptRecord[] = [];
  while (merged.length < totalCount) {
    const chosenList = selectEarliestList(recordLists, sortKeys, positions);
    merged.push(recordLists[chosenList]![positions[chosenList]!]!);
    positions[chosenList]! += 1;
  }
  return merged;
}

// §c composition: dedupe, interleave by wall clock, graft fork roots, join cross-source identities.
export function mergeMultiSourceRecords(recordLists: TranscriptRecord[][], sources: SourceEntry[], overrides: PathOverrides): TranscriptRecord[] {
  const seen = new Set<string>();
  const dedupedLists: TranscriptRecord[][] = [];
  for (const list of recordLists) {
    dedupedLists.push(removeDuplicateRecordsBySessionAndUuid(list, seen));
  }
  const interleaved = attachForkedSubagentRoots(mergeRecordsByTimestamp(dedupedLists));
  return joinCrossSourceFileIdentities(interleaved, sources, computeSessionRoots(interleaved, sources), overrides);
}
