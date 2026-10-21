// Record predicates for same-turn trunk absorption, split from reconstruction_trunk_absorb.ts for the line cap.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";

// The message.id shared by every sibling record of one API response.
export function findResponseMessageId(record: TranscriptRecord): string | undefined {
  const message = record.message as { id?: string } | undefined;
  return message?.id;
}

// True when the user record holds only tool_result blocks.
function isRecordToolResultOnly(record: TranscriptRecord): boolean {
  if (record.type !== RecordType.user) {
    return false;
  }
  const message = record.message as { content?: unknown } | undefined;
  const content = message?.content;
  const contentIsArray = Array.isArray(content);
  if (!contentIsArray) {
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

// True when the record has no uuid or is already on the trunk.
export function isRecordAlreadyKept(record: TranscriptRecord, trunk: Set<string>): boolean {
  if (record.uuid === undefined) {
    return true;
  }
  return trunk.has(record.uuid.toString());
}

// True when the record is an attachment or a bare tool_result echo.
function isRecordPlumbing(record: TranscriptRecord): boolean {
  if (record.type === RecordType.attachment) {
    return true;
  }
  return isRecordToolResultOnly(record);
}

// True when plumbing hangs off the trunk and only plumbing lies below it.
export function isRecordJoiningAbsorbedTurn(record: TranscriptRecord, trunk: Set<string>, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
  const parent = record.parentUuid;
  if (parent === undefined) {
    return false;
  }
  if (parent === null) {
    return false;
  }
  const parentIsOnTrunk = trunk.has(parent.toString());
  if (!parentIsOnTrunk) {
    return false;
  }
  const recordIsPlumbing = isRecordPlumbing(record);
  if (!recordIsPlumbing) {
    return false;
  }
  return isSubtreePlumbingOnly(record, childrenByParent);
}

// True when every descendant of the record is plumbing.
function isSubtreePlumbingOnly(record: TranscriptRecord, childrenByParent: Map<string, TranscriptRecord[]>): boolean {
  for (const child of childrenByParent.get(record.uuid!.toString()) ?? []) {
    const childIsPlumbing = isRecordPlumbing(child);
    if (!childIsPlumbing) {
      return false;
    }
    const childSubtreeIsPlumbing = isSubtreePlumbingOnly(child, childrenByParent);
    if (!childSubtreeIsPlumbing) {
      return false;
    }
  }
  return true;
}
