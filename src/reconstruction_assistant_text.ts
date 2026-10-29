import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";

// True when an assistant record carries displayed text (not tool_use/thinking-only).
export function containsAssistantText(record: TranscriptRecord): boolean {
  if (record.type !== RecordType.assistant) {
    return false;
  }
  const message = record.message as { content?: unknown } | undefined;
  const content = message?.content;
  const isStringContent = typeof content === "string";
  if (isStringContent) {
    return content.trim() !== "";
  }
  for (const block of getContentBlocks(record)) {
    if (block.type !== BlockType.text) {
      continue;
    }
    const hasDisplayedText = block.text.trim() !== "";
    if (hasDisplayedText) {
      return true;
    }
  }
  return false;
}
