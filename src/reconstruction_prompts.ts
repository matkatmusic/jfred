// Genuine user prompts and the parentUuid fork points they reveal, split from reconstruction_tree.ts.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock, type TextBlock } from "./structures/content-blocks.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";

// True for a typed-in user prompt: not isMeta, no tool_result block, so tool results never count.
export function isGenuineUserPrompt(record: TranscriptRecord): boolean {
  if (record.type !== RecordType.user) {
    return false;
  }
  if (record.origin?.kind === "human") {
    return true;
  }
  if (record.isMeta === true) {
    return false;
  }
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_result) {
      return false;
    }
  }
  return true;
}

// A prompt's text: string content as is, array content as its TextBlocks joined by newlines.
function readPromptText(record: TranscriptRecord): string {
  const message = record.message as { content?: unknown } | undefined;
  if (typeof message?.content === "string") {
    return message.content;
  }
  const texts: string[] = [];
  for (const block of getContentBlocks(record)) {
    const isText = isTextBlock(block);
    if (isText) {
      texts.push(block.text);
    }
  }
  return texts.join("\n");
}

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === BlockType.text;
}

// Text of the first non-blank genuine prompt (the Layer 1 session title), or "" when none exists.
export function readFirstUserPrompt(records: TranscriptRecord[]): string {
  for (const record of records) {
    const isPrompt = isGenuineUserPrompt(record);
    if (!isPrompt) {
      continue;
    }
    const text = readPromptText(record);
    const trimmedText = text.trim();
    if (trimmedText !== "") {
      return text;
    }
  }
  return "";
}

// Parents of two or more genuine prompts, in first-appearance order: each is a rewind fork point.
export function findPromptForkPoints(records: TranscriptRecord[]): Uuid[] {
  const promptParents = new Map<string, { parent: Uuid; count: number }>();
  const order: string[] = [];
  for (const record of records) {
    const isPrompt = isGenuineUserPrompt(record);
    if (!isPrompt) {
      continue;
    }
    const parent = record.parentUuid;
    const isParentMissing = parent === undefined;
    const isParentNull = parent === null;
    const isParentAbsent = isParentMissing || isParentNull;
    if (isParentAbsent) {
      continue;
    }
    const key = parent.toString();
    const existing = promptParents.get(key);
    if (existing === undefined) {
      promptParents.set(key, { parent, count: 1 });
      order.push(key);
      continue;
    }
    existing.count += 1;
  }
  const forkParents: Uuid[] = [];
  for (const key of order) {
    const entry = promptParents.get(key)!;
    if (entry.count >= 2) {
      forkParents.push(entry.parent);
    }
  }
  return forkParents;
}
