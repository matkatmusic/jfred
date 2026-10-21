// Same-turn trunk absorption (task 145): parallel tool-call siblings and their result echoes join the trunk.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { RecordType } from "./structures/vocabulary.ts";
import { findResponseMessageId, isRecordAlreadyKept, isRecordJoiningAbsorbedTurn } from "./reconstruction_trunk_absorb_predicates.ts";

// Children indexed by parent uuid, for the subtree walks.
function buildChildrenByParent(records: TranscriptRecord[]): Map<string, TranscriptRecord[]> {
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

// Rule (1): absorb every assistant record sharing a message.id with a trunk assistant record.
function addSameResponseAssistantSiblings(records: TranscriptRecord[], trunk: Set<string>): void {
  const trunkMessageIds = new Set<string>();
  for (const record of records) {
    if (record.type !== RecordType.assistant) {
      continue;
    }
    if (record.uuid === undefined) {
      continue;
    }
    const recordIsOnTrunk = trunk.has(record.uuid.toString());
    if (!recordIsOnTrunk) {
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
    const recordIsKept = isRecordAlreadyKept(record, trunk);
    if (recordIsKept) {
      continue;
    }
    const messageId = findResponseMessageId(record);
    if (messageId === undefined) {
      continue;
    }
    const responseIsOnTrunk = trunkMessageIds.has(messageId);
    if (responseIsOnTrunk) {
      trunk.add(record.uuid!.toString());
    }
  }
}

// One absorption sweep of rule (2); true when any record was absorbed.
function addTurnTailsOnce(records: TranscriptRecord[], trunk: Set<string>, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
  let absorbedAny = false;
  for (const record of records) {
    const recordIsKept = isRecordAlreadyKept(record, trunk);
    if (recordIsKept) {
      continue;
    }
    const recordJoinsTurn = isRecordJoiningAbsorbedTurn(record, trunk, childrenByParent);
    if (!recordJoinsTurn) {
      continue;
    }
    trunk.add(record.uuid!.toString());
    absorbedAny = true;
  }
  return absorbedAny;
}

export function addParallelToolCallSiblings(records: TranscriptRecord[], trunk: Set<string>): void {
  addSameResponseAssistantSiblings(records, trunk);
  // Rule (2): sweep result echoes and attachments until the trunk stops growing.
  const childrenByParent = buildChildrenByParent(records);
  while (addTurnTailsOnce(records, trunk, childrenByParent)) {
    // the sweep itself mutates trunk.
  }
}
