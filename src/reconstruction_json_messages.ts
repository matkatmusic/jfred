// Message builders for reconstruction_json.ts.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { RecordType, BlockType } from "./structures/vocabulary.ts";
import { getContentBlocks, type TextBlock } from "./structures/content-blocks.ts";
import type { ConversationMessage } from "./reconstruction_json.ts";

// Extracts displayed text from a record; joins TextBlocks or returns "".
export function extractMessageText(record: TranscriptRecord): string {
  const message = record.message as { content?: unknown } | undefined;
  if (message !== undefined && typeof message.content === "string") {
    return message.content;
  }
  const textBlocks = getContentBlocks(record).filter(
    (block): block is TextBlock => block.type === BlockType.text,
  );
  return textBlocks.map((block) => block.text).join("\n");
}

// Build one ConversationMessage from a record (caller has already decided it qualifies).
export function buildConversationMessage(record: TranscriptRecord, orphanedUuids: Set<string>): ConversationMessage {
  return {
    uuid: record.uuid,
    parentUuid: record.parentUuid ?? undefined,
    role: record.type as RecordType,
    timestamp: record.timestamp,
    text: extractMessageText(record),
    sessionId: record.sessionId,
    isOrphaned: record.uuid !== undefined && orphanedUuids.has(record.uuid.toString()),
  };
}
