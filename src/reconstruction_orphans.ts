// Orphaned-record detection for the conversation-branch model (reconstruction_branch.ts): the
// uuid set of every record on a rewound (abandoned) branch, with tool-plumbing micro-forks
// (PreToolUse-hook command rewrites) skipped.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import {
    collectAncestorUuids,
    indexRecordsByUuid,
} from "./reconstruction_tree.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";
import {
    collectSurvivingUuids,
    findConversationBranches,
} from "./reconstruction_branch.ts";

// The uuid strings of every record on a rewound (abandoned) branch: the abandoned tips' chains
// minus the surviving trunk, plus every record whose parentUuid chain reaches that set before
// the trunk (post-tip descendants like a rewound "Looks good." exchange, and off-chain records
// parented into the dead stretch). Hook attachments and dangling leaves parented to surviving
// records resolve to the trunk and are NOT orphaned. Empty when there are no rewound branches.
// A hook command-rewrite (e.g. rtk PreToolUse) forks the tree mid-tool-call; the dead
// side is pure tool plumbing, not a /rewind the user should see dimmed. Skip it.
// The tip's ancestor-chain uuids that are not on the surviving trunk.
function collectBranchExclusiveUuids(
    records: TranscriptRecord[],
    tip: Uuid,
    surviving: Set<string>,
): Set<string> {
    const exclusive = new Set<string>();
    for (const uuid of collectAncestorUuids(records, tip)) {
        if (!surviving.has(uuid)) {
            exclusive.add(uuid);
        }
    }
    return exclusive;
}

export function collectOrphanedUuids(records: TranscriptRecord[]): Set<string> {
    const rewoundTips = findConversationBranches(records).filter((branch) => !branch.isSurviving);
    if (rewoundTips.length === 0) {
        return new Set<string>();
    }
    const surviving = collectSurvivingUuids(records);
    const byUuid = indexRecordsByUuid(records);
    const abandoned = new Set<string>();
    for (const branch of rewoundTips) {
        const exclusive = collectBranchExclusiveUuids(records, branch.tip, surviving);
        if (checkBranchIsToolPlumbing(records, byUuid, surviving, exclusive)) {
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
    // ponytail: walk is O(records × depth) uncached; most records exit on their own uuid —
    // memoize in CorpusState if a large project measures slow.
    for (const record of records) {
        if (record.uuid === undefined) {
            continue;
        }
        if (checkChainReachesAbandoned(record, byUuid, surviving, abandoned)) {
            orphaned.add(record.uuid.toString());
        }
    }
    return orphaned;
}

// True when the record's parentUuid chain (starting at the record itself) hits the abandoned
// set before the surviving trunk. Same cycle-guarded walk as findRewindPoint.
function checkChainReachesAbandoned(
    record: TranscriptRecord,
    byUuid: Map<string, TranscriptRecord>,
    surviving: Set<string>,
    abandoned: Set<string>,
): boolean {
    const visited = new Set<string>();
    let current: TranscriptRecord | undefined = record;
    while (current !== undefined && current.uuid !== undefined) {
        const key = current.uuid.toString();
        if (visited.has(key)) {
            return false;
        }
        visited.add(key);
        if (abandoned.has(key)) {
            return true;
        }
        if (surviving.has(key)) {
            return false;
        }
        const parent = current.parentUuid;
        if (parent === undefined || parent === null) {
            return false;
        }
        current = byUuid.get(parent.toString());
    }
    return false;
}

// True when the tip's branch-exclusive subtree (the exclusive ancestor set plus every record whose
// parentUuid chain reaches it before the trunk — trailing attachments, post-tip exchanges) holds
// nothing but tool plumbing: no genuine user prompt and no assistant text. Such micro-forks come
// from PreToolUse-hook command rewrites (a tool_use with two tool_result children), not a /rewind.
function checkBranchIsToolPlumbing(
    records: TranscriptRecord[],
    byUuid: Map<string, TranscriptRecord>,
    surviving: Set<string>,
    exclusive: Set<string>,
): boolean {
    for (const record of records) {
        if (record.uuid === undefined) {
            continue;
        }
        if (!checkChainReachesAbandoned(record, byUuid, surviving, exclusive)) {
            continue;
        }
        if (isGenuineUserPrompt(record)) {
            return false;
        }
        if (checkAssistantHasText(record)) {
            return false;
        }
    }
    return true;
}

// True when an assistant record carries displayed text: a non-empty string content or a non-empty
// TextBlock (extractMessageText's two shapes). tool_use-only and thinking-only replies are not text.
function checkAssistantHasText(record: TranscriptRecord): boolean {
    if (record.type !== RecordType.assistant) {
        return false;
    }
    const message = record.message as { content?: unknown } | undefined;
    if (message !== undefined && typeof message.content === "string") {
        return message.content.trim() !== "";
    }
    return getContentBlocks(record).some(
        (block) => block.type === BlockType.text && block.text.trim() !== "",
    );
}
