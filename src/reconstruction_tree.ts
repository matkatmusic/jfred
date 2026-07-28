// Generic conversation-tree walkers over the `parentUuid` forest and the `last-prompt` heads. The canonical home for ancestor-chain and head lookups; reconstruction_branch.ts and the surviving-head decision both build on these. See plans/s8/s8-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getLastPromptEntry } from "./structures/session-meta.ts";
import { RecordType } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";

// Index the records that carry a uuid by that uuid string, for ancestor-chain walks.
export function indexRecordsByUuid(
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

// In file order, the leafUuid of each last-prompt record — the conversation heads.
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

// Index records by their parentUuid string — every record's children, for downward forest walks.
function indexChildrenByParent(
    records: TranscriptRecord[],
): Map<string, TranscriptRecord[]> {
    const byParent = new Map<string, TranscriptRecord[]>();
    for (const record of records) {
        const parent = record.parentUuid;
        if (parent === undefined || parent === null) {
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

// The uuid strings of every descendant of `start` in the parentUuid forest, EXCLUSIVE of `start`. BFS down, following children of every record type — the abandoned subtree threads through `attachment` intermediaries between a prompt and its assistant continuation, so a type-filtered walk would stop short. The downward dual of collectAncestorUuids. See plans/s13/s13-reconstruction-plan.md.
export function collectDescendantUuids(
    records: TranscriptRecord[],
    start: Uuid,
): Set<string> {
    const byParent = indexChildrenByParent(records);
    const descendants = new Set<string>();
    const queue: string[] = [start.toString()];
    while (queue.length > 0) {
        const parentKey = queue.shift()!;
        const fresh = recordNewChildren(byParent.get(parentKey) ?? [], descendants);
        queue.push(...fresh);
    }
    return descendants;
}

// Add each not-yet-seen child's uuid to `descendants` and return those freshly-added uuid strings, so the BFS queue is extended only by children it has not already visited.
function recordNewChildren(
    siblings: TranscriptRecord[],
    descendants: Set<string>,
): string[] {
    const fresh: string[] = [];
    for (const child of siblings) {
        const childKey = child.uuid!.toString();
        if (!descendants.has(childKey)) {
            descendants.add(childKey);
            fresh.push(childKey);
        }
    }
    return fresh;
}

// Among `start`'s descendants, the uuid of the latest-timestamp record whose type is user or assistant — the abandoned branch's conversational tip (mirroring how a surviving tip is a conversational head, not a trailing system/attachment bookkeeping record). undefined when the subtree holds no user/assistant record. See plans/s13/s13-reconstruction-plan.md.
export function findDeepestPromptOrReply(
    records: TranscriptRecord[],
    start: Uuid,
): Uuid | undefined {
    const descendants = collectDescendantUuids(records, start);
    const byUuid = indexRecordsByUuid(records);
    let deepest: TranscriptRecord | undefined = undefined;
    for (const key of descendants) {
        const record = byUuid.get(key);
        if (record === undefined) {
            continue;
        }
        if (!isConversationalTurn(record)) {
            continue;
        }
        if (isLaterThan(record, deepest)) {
            deepest = record;
        }
    }
    return deepest?.uuid;
}

// True when `record` is a user or assistant turn (the conversational record types that can name a tip).
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

// The uuid strings on `tip`'s parentUuid ancestor chain, including the tip itself. Empty when the tip resolves to no record (the caller reads that as "cannot identify"). Stops at a null or unresolvable parent, or when a uuid repeats (cycle guard).
export function collectAncestorUuids(
    records: TranscriptRecord[],
    tip: Uuid,
): Set<string> {
    const byUuid = indexRecordsByUuid(records);
    const ancestors = new Set<string>();
    let current = byUuid.get(tip.toString());
    while (current !== undefined) {
        const key = current.uuid!.toString();
        if (ancestors.has(key)) {
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

// The first last-prompt head at or above `start` — walk start -> root by parentUuid and return the first uuid that is itself a conversation head. undefined when none is found (cycle/eof guarded).  Used to map a working-tree owner record up to the conversation head that owns that working tree.
export function findHeadAtOrAbove(
    records: TranscriptRecord[],
    start: Uuid,
): Uuid | undefined {
    const headKeys = new Set(collectHeadUuids(records).map((head) => head.toString()));
    const byUuid = indexRecordsByUuid(records);
    const visited = new Set<string>();
    let current = byUuid.get(start.toString());
    while (current !== undefined) {
        const key = current.uuid!.toString();
        if (visited.has(key)) {
            break;
        }
        visited.add(key);
        if (headKeys.has(key)) {
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

