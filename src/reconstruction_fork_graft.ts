// Grafts forked-subagent chains onto the parent session tree so reconstructBranches sees each fork as a branch.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { AgentId, Uuid } from "./structures/domain.ts";
import { getForkContextRefEntry } from "./structures/session-meta.ts";
import { getRecordSource, setRecordSource } from "./parse/loadTranscript.ts";
import type { ConversationBranch } from "./reconstruction_branch.ts";
import { findDeepestPromptOrReply, indexRecordsByUuid } from "./reconstruction_tree.ts";

// True when the record is a sidechain chain root (no parent) owned by `agentId`.
function isChainRootOfAgent(record: TranscriptRecord, agentId: AgentId): boolean {
    if (record.uuid === undefined) {
        return false;
    }
    if (record.parentUuid !== null) {
        return false;
    }
    return record.agentId === agentId.toString();
}

// The first chain root owned by `agentId`, or undefined when the subagent file was not loaded.
function findChainRootOfAgent(records: TranscriptRecord[], agentId: AgentId): TranscriptRecord | undefined {
    for (const record of records) {
        if (isChainRootOfAgent(record, agentId)) {
            return record;
        }
    }
    return undefined;
}

// A copy of the root whose parentUuid points into the parent session; keeps the source stamp.
function cloneRootWithParent(root: TranscriptRecord, parentUuid: Uuid): TranscriptRecord {
    const clone = { ...root, parentUuid } as TranscriptRecord;
    const source = getRecordSource(root);
    if (source !== undefined) {
        setRecordSource(clone, source);
    }
    return clone;
}

// Rewrites each loaded subagent root's parentUuid to its fork's parentLastUuid; same array when nothing grafts.
export function attachForkedSubagentRoots(records: TranscriptRecord[]): TranscriptRecord[] {
    const byUuid = indexRecordsByUuid(records);
    const clonesByRoot = new Map<TranscriptRecord, TranscriptRecord>();
    for (const record of records) {
        const forkRef = getForkContextRefEntry(record);
        if (forkRef === undefined) {
            continue;
        }
        const parentIsLoaded = byUuid.has(forkRef.parentLastUuid.toString());
        const root = findChainRootOfAgent(records, forkRef.agentId);
        if (!parentIsLoaded || root === undefined) {
            continue;
        }
        clonesByRoot.set(root, cloneRootWithParent(root, forkRef.parentLastUuid));
    }
    if (clonesByRoot.size === 0) {
        return records;
    }
    const grafted: TranscriptRecord[] = [];
    for (const record of records) {
        grafted.push(clonesByRoot.get(record) ?? record);
    }
    return grafted;
}

// One non-surviving branch per grafted root, tipped at the fork's deepest reply and forked at parentLastUuid.
export function findForkedSubagentBranches(
    records: TranscriptRecord[],
    existingTips: Set<string>,
): ConversationBranch[] {
    const claimed = new Set<string>(existingTips);
    const branches: ConversationBranch[] = [];
    for (const record of records) {
        const forkRef = getForkContextRefEntry(record);
        if (forkRef === undefined) {
            continue;
        }
        const root = findGraftedRootOfAgent(records, forkRef.agentId, forkRef.parentLastUuid);
        if (root === undefined) {
            continue;
        }
        const rootUuid = root.uuid!;
        const tip = findDeepestPromptOrReply(records, rootUuid) ?? rootUuid;
        if (claimed.has(tip.toString())) {
            continue;
        }
        claimed.add(tip.toString());
        branches.push({ tip, rewindPoint: forkRef.parentLastUuid, isSurviving: false });
    }
    return branches;
}

// The agent's chain root once grafted: its parentUuid equals the fork's parentLastUuid.
function findGraftedRootOfAgent(
    records: TranscriptRecord[],
    agentId: AgentId,
    parentLastUuid: Uuid,
): TranscriptRecord | undefined {
    for (const record of records) {
        const isAgentRecord = record.agentId === agentId.toString();
        const isGraftedHere = record.parentUuid?.toString() === parentLastUuid.toString();
        if (isAgentRecord && isGraftedHere) {
            return record;
        }
    }
    return undefined;
}
