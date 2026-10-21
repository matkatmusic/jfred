// Multi-source merging: dedupe, wall-clock interleave, per-session root resolution.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { sessionIdOf, joinCrossSourceFileIdentities } from "./reconstruction_multi_source_join.ts";
import { computeSessionRoots } from "./reconstruction_multi_source_roots.ts";
import { attachForkedSubagentRoots } from "./reconstruction_fork_graft.ts";

// The dedupe identity of one record, or undefined when it carries no (sessionId, uuid) pair.
function computeRecordIdentityKey(record: TranscriptRecord): string | undefined {
    const sessionId = sessionIdOf(record);
    if (sessionId === undefined || record.uuid === undefined) {
        return undefined;
    }
    return `${sessionId.toString()} ${record.uuid.toString()}`;
}

// §c1: dedupe by (sessionId, uuid); first wins.
export function dedupeRecordsBySessionAndUuid(
    records: TranscriptRecord[],
    seen: Set<string> = new Set<string>(),
): TranscriptRecord[] {
    const kept: TranscriptRecord[] = [];
    for (const record of records) {
        const identityKey = computeRecordIdentityKey(record);
        if (identityKey !== undefined && seen.has(identityKey)) {
            continue;
        }
        if (identityKey !== undefined) {
            seen.add(identityKey);
        }
        kept.push(record);
    }
    return kept;
}

// Sort key: own timestamp, else carried-forward, else first stamped.
function computeListSortKeys(records: TranscriptRecord[]): number[] {
    const firstStamped = records.find((record) => record.timestamp !== undefined);
    let carriedKey = firstStamped?.timestamp?.getTime() ?? Number.POSITIVE_INFINITY;
    return records.map((record) => {
        if (record.timestamp !== undefined) {
            carriedKey = record.timestamp.getTime();
        }
        return carriedKey;
    });
}

// Pick the list with the smallest next sort key.
function chooseEarliestList(recordLists: TranscriptRecord[][], sortKeys: number[][], positions: number[]): number {
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
export function interleaveRecordsByTimestamp(recordLists: TranscriptRecord[][]): TranscriptRecord[] {
    const sortKeys = recordLists.map(computeListSortKeys);
    const positions = recordLists.map(() => 0);
    const totalCount = recordLists.reduce((count, list) => count + list.length, 0);
    const merged: TranscriptRecord[] = [];
    while (merged.length < totalCount) {
        const chosenList = chooseEarliestList(recordLists, sortKeys, positions);
        merged.push(recordLists[chosenList]![positions[chosenList]!]!);
        positions[chosenList]! += 1;
    }
    return merged;
}

// Unstamped records stay glued to their neighbor's session group.
function selectGroupForRecord(
    record: TranscriptRecord,
    groups: TranscriptRecord[][],
    groupBySession: Map<string, TranscriptRecord[]>,
    currentGroup: TranscriptRecord[] | undefined,
): TranscriptRecord[] {
    const sessionId = sessionIdOf(record);
    if (sessionId === undefined) {
        if (currentGroup !== undefined) {
            return currentGroup;
        }
        const leadingGroup: TranscriptRecord[] = [];
        groups.push(leadingGroup);
        return leadingGroup;
    }
    const existingGroup = groupBySession.get(sessionId.toString());
    if (existingGroup !== undefined) {
        return existingGroup;
    }
    const newGroup: TranscriptRecord[] = [];
    groupBySession.set(sessionId.toString(), newGroup);
    groups.push(newGroup);
    return newGroup;
}

// A flat merged stream regrouped into per-session lists (first-seen order).
export function groupRecordsBySession(records: TranscriptRecord[]): TranscriptRecord[][] {
    const groups: TranscriptRecord[][] = [];
    const groupBySession = new Map<string, TranscriptRecord[]>();
    let currentGroup: TranscriptRecord[] | undefined;
    for (const record of records) {
        currentGroup = selectGroupForRecord(record, groups, groupBySession, currentGroup);
        currentGroup.push(record);
    }
    return groups;
}

// §c composition: dedupe, interleave by wall clock, graft fork roots, join cross-source identities.
export function mergeMultiSourceRecords(recordLists: TranscriptRecord[][], sources: SourceEntry[]): TranscriptRecord[] {
    const seen = new Set<string>();
    const dedupedLists = recordLists.map((list) => dedupeRecordsBySessionAndUuid(list, seen));
    const interleaved = attachForkedSubagentRoots(interleaveRecordsByTimestamp(dedupedLists));
    return joinCrossSourceFileIdentities(interleaved, sources, computeSessionRoots(interleaved, sources));
}
