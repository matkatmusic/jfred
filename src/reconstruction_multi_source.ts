// Multi-source record merging (specs S4b/S5a, design plans/166-multi-source-design.md §b/§c):
// the stages between per-source record loading and the existing engine — record-level dedupe
// (§c1), wall-clock interleave (§c3), per-session root resolution (§b), and the merge
// composition. The §a identity join lives in reconstruction_multi_source_join.ts (250-line cap
// split; this module imports it one-way).

import { dirname } from "node:path";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { getRecordSource } from "./parse/loadTranscript.ts";
import { findMatchingSourceEntry } from "./reconstruction_sidecar_reader.ts";
import { sessionIdOf, joinCrossSourceFileIdentities } from "./reconstruction_multi_source_join.ts";

// The dedupe identity of one record, or undefined when it carries no (sessionId, uuid) pair.
function computeRecordIdentityKey(record: TranscriptRecord): string | undefined {
    const sessionId = sessionIdOf(record);
    if (sessionId === undefined || record.uuid === undefined) {
        return undefined;
    }
    return `${sessionId.toString()} ${record.uuid.toString()}`;
}

// §c1 — record-level dedupe by (sessionId, uuid), first occurrence winning (replica copies are
// strict prefix growth, so the union of records IS the longer copy). Records missing either
// identity field always pass through. `seen` is shared across lists by the merge composition.
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

// Per-record sort keys for one list: a record's own timestamp, else the carried-forward previous
// one, else the list's FIRST stamped timestamp (unstamped leading records stay glued in front of
// their session). A list with no timestamps at all sorts last.
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

// The index of the not-yet-exhausted list whose next record has the smallest sort key; ties
// resolve to the earlier list (deterministic).
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

// §c3 — strict wall-clock interleave of per-session record lists, each list's internal order
// preserved.
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

// The (possibly new) group a record belongs to: its session's group, else the group of the
// record before it (unstamped snapshot records stay glued to their neighbors).
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

// The declared root of the source that recorded this record, or undefined when no declared
// source matches (§b1: the source's projects root is dirname(dirname(<jsonl path>))).
function findDeclaredRootForRecord(record: TranscriptRecord, sources: SourceEntry[]): Path | undefined {
    const recordSource = getRecordSource(record);
    if (recordSource === undefined) {
        return undefined;
    }
    const projectsRoot = dirname(dirname(recordSource.filePath));
    return findMatchingSourceEntry(sources, projectsRoot)?.root;
}

// §b — each session's workspace root: the matching declared source's root (config wins, §b3),
// else the session's first recorded cwd (§b2 auto-detect). Keyed by sessionId string.
export function computeSessionRoots(records: TranscriptRecord[], sources: SourceEntry[]): Map<string, Path> {
    const declaredRoots = new Map<string, Path>();
    const fallbackCwds = new Map<string, Path>();
    for (const record of records) {
        const sessionId = sessionIdOf(record);
        if (sessionId === undefined) {
            continue;
        }
        const sessionKey = sessionId.toString();
        if (!declaredRoots.has(sessionKey)) {
            const declaredRoot = findDeclaredRootForRecord(record, sources);
            if (declaredRoot !== undefined) {
                declaredRoots.set(sessionKey, declaredRoot);
            }
        }
        if (!fallbackCwds.has(sessionKey) && record.cwd !== undefined) {
            fallbackCwds.set(sessionKey, record.cwd);
        }
    }
    const roots = new Map<string, Path>(fallbackCwds);
    for (const [sessionKey, declaredRoot] of declaredRoots) {
        roots.set(sessionKey, declaredRoot);
    }
    return roots;
}

// The public composition (design §c order): dedupe each list against one shared seen-set, then
// interleave by wall clock, then join cross-source identities. One list under one root degrades
// to the identity transform.
export function mergeMultiSourceRecords(recordLists: TranscriptRecord[][], sources: SourceEntry[]): TranscriptRecord[] {
    const seen = new Set<string>();
    const dedupedLists = recordLists.map((list) => dedupeRecordsBySessionAndUuid(list, seen));
    const interleaved = interleaveRecordsByTimestamp(dedupedLists);
    return joinCrossSourceFileIdentities(interleaved, sources, computeSessionRoots(interleaved, sources));
}
