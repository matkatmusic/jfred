// Same-turn trunk absorption (task 145), split from reconstruction_trunk.ts for the line cap.
// Parallel tool calls split ONE assistant API response into sibling JSONL records that share
// message.id; each tool_result then parents onto ITS OWN tool_use sibling, so the surviving
// ancestor walk reaches only one sibling's chain and the others dead-end (s85's `Write two.py`
// record and its result). Those records are the same live turn, not a rewind — the trunk
// absorbs them:
//  (1) any assistant record sharing a trunk assistant record's message.id;
//  (2) then, to a fixed point, any tool_result-only user record or attachment record whose
//      parent is already absorbed.
// A real rewound branch can never match: its records belong to a different API response (a new
// message.id) and its first diverging record is a prompt/assistant turn, not a bare tool_result.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";

// The message.id of an assistant record's API response — shared across every sibling record a
// multi-block response was split into. undefined for records with no message id.
function findResponseMessageId(record: TranscriptRecord): string | undefined {
    const message = record.message as { id?: string } | undefined;
    return message?.id;
}

// True when the user record's content is entirely tool_result blocks — a bare result echo of
// some tool_use, carrying no prompt of its own.
function checkRecordIsToolResultOnly(record: TranscriptRecord): boolean {
    if (record.type !== RecordType.user) {
        return false;
    }
    const message = record.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) {
        return false;
    }
    if (content.length === 0) {
        return false;
    }
    for (const block of content) {
        const blockType = (block as { type?: string }).type;
        if (blockType !== BlockType.tool_result) {
            return false;
        }
    }
    return true;
}

// True when the record's uuid is absent or already on the trunk — nothing to absorb.
function checkRecordIsAlreadyKept(record: TranscriptRecord, trunk: Set<string>): boolean {
    if (record.uuid === undefined) {
        return true;
    }
    return trunk.has(record.uuid.toString());
}

// True when the record is plumbing: an attachment or a bare tool_result echo. Anything else
// (a user prompt, an assistant reply) is real conversational content.
function checkRecordIsPlumbing(record: TranscriptRecord): boolean {
    if (record.type === RecordType.attachment) {
        return true;
    }
    return checkRecordIsToolResultOnly(record);
}

// True when the record is the same-turn tail of an absorbed chain: plumbing parented on a
// record the trunk already holds, with NOTHING but plumbing below it. A dead-end tool_result
// followed by real content (a hook-rewrite fork the user rewound after an assistant reply) is
// a genuine rewound exchange and must stay off the trunk so it still dims.
function checkRecordJoinsAbsorbedTurn(record: TranscriptRecord, trunk: Set<string>, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
    const parent = record.parentUuid;
    if (parent === undefined) {
        return false;
    }
    if (parent === null) {
        return false;
    }
    if (!trunk.has(parent.toString())) {
        return false;
    }
    if (!checkRecordIsPlumbing(record)) {
        return false;
    }
    return checkSubtreeIsPlumbingOnly(record, childrenByParent);
}

// True when every descendant of `record` is plumbing (depth-first over the parentUuid tree).
function checkSubtreeIsPlumbingOnly(record: TranscriptRecord, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
    for (const child of childrenByParent.get(record.uuid!.toString()) ?? []) {
        if (!checkRecordIsPlumbing(child)) {
            return false;
        }
        if (!checkSubtreeIsPlumbingOnly(child, childrenByParent)) {
            return false;
        }
    }
    return true;
}

// Children indexed by parent uuid, for the subtree walks above.
function indexChildrenByParent(records: TranscriptRecord[]): Map<string, TranscriptRecord[]> {
    const childrenByParent = new Map<string, TranscriptRecord[]>();
    for (const record of records) {
        if (record.uuid === undefined) {
            continue;
        }
        const parent = record.parentUuid;
        if (parent === undefined) {
            continue;
        }
        if (parent === null) {
            continue;
        }
        const siblings = childrenByParent.get(parent.toString()) ?? [];
        siblings.push(record);
        childrenByParent.set(parent.toString(), siblings);
    }
    return childrenByParent;
}

// Rule (1): absorb every assistant record that shares a message.id with a trunk assistant
// record — the split siblings of an API response the trunk already holds part of.
function absorbSameResponseAssistantSiblings(records: TranscriptRecord[], trunk: Set<string>): void {
    const trunkMessageIds = new Set<string>();
    for (const record of records) {
        if (record.type !== RecordType.assistant) {
            continue;
        }
        if (record.uuid === undefined) {
            continue;
        }
        if (!trunk.has(record.uuid.toString())) {
            continue;
        }
        const messageId = findResponseMessageId(record);
        if (messageId !== undefined) {
            trunkMessageIds.add(messageId);
        }
    }
    for (const record of records) {
        if (record.type !== RecordType.assistant) {
            continue;
        }
        if (checkRecordIsAlreadyKept(record, trunk)) {
            continue;
        }
        const messageId = findResponseMessageId(record);
        if (messageId === undefined) {
            continue;
        }
        if (trunkMessageIds.has(messageId)) {
            trunk.add(record.uuid!.toString());
        }
    }
}

// One absorption sweep of rule (2); true when any record was absorbed.
function absorbTurnTailsOnce(records: TranscriptRecord[], trunk: Set<string>, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
    let absorbedAny = false;
    for (const record of records) {
        if (checkRecordIsAlreadyKept(record, trunk)) {
            continue;
        }
        if (!checkRecordJoinsAbsorbedTurn(record, trunk, childrenByParent)) {
            continue;
        }
        trunk.add(record.uuid!.toString());
        absorbedAny = true;
    }
    return absorbedAny;
}

export function absorbParallelToolCallSiblings(records: TranscriptRecord[], trunk: Set<string>): void {
    absorbSameResponseAssistantSiblings(records, trunk);
    // Rule (2): the absorbed siblings' result echoes and attachments, to a fixed point —
    // an absorbed record may be the parent the next tail needs, so sweep until stable.
    const childrenByParent = indexChildrenByParent(records);
    while (absorbTurnTailsOnce(records, trunk, childrenByParent)) {
        // the sweep itself mutates trunk; nothing further to do per pass.
    }
}
