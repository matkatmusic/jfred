import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Uuid } from "../src/structures/domain.ts";

export function buildTextBlock(text: string): Record<string, unknown> {
  return { type: BlockType.text, text };
}

export function buildToolResultBlock(): Record<string, unknown> {
  return { type: BlockType.tool_result, tool_use_id: "toolu_x", content: "ok", is_error: false };
}

export function buildRecord(
  recordType: RecordType,
  uuid: string,
  parentUuid: string | null,
  timestamp: string,
  blocks: Record<string, unknown>[],
): TranscriptRecord {
  return {
    type: recordType,
    uuid: new Uuid(uuid),
    parentUuid: parentUuid === null ? null : new Uuid(parentUuid),
    timestamp: new Date(timestamp),
    message: { content: blocks },
  } as unknown as TranscriptRecord;
}

// The shape of a real typed-in prompt.
export function buildUserTextRecord(
  uuid: string,
  parentUuid: string | null,
  text: string,
  timestamp: string,
): TranscriptRecord {
  return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildTextBlock(text)]);
}

// A tool result is a `user`-typed record but NOT a typed-in prompt.
export function buildUserToolResultRecord(
  uuid: string,
  parentUuid: string,
  timestamp: string,
): TranscriptRecord {
  return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildToolResultBlock()]);
}

export function buildAssistantRecord(
  uuid: string,
  parentUuid: string,
  text: string,
  timestamp: string,
): TranscriptRecord {
  return {
    type: RecordType.assistant,
    uuid: new Uuid(uuid),
    parentUuid: new Uuid(parentUuid),
    timestamp: new Date(timestamp),
    message: { content: [{ type: BlockType.text, text }] },
  } as unknown as TranscriptRecord;
}

// A side-record that threads into the tree but is not a prompt.
export function buildAttachmentRecord(
  uuid: string,
  parentUuid: string,
  timestamp: string,
): TranscriptRecord {
  return buildRecord(RecordType.attachment, uuid, parentUuid, timestamp, []);
}
