import type { TranscriptRecord } from "./envelope.ts";
import { BlockType, KNOWN_CONTENT_BLOCK_TYPES } from "./vocabulary.ts";
import { Uuid } from "./domain.ts";

export type TextBlock = {
  type: BlockType.text;
  text: string;
};

export type ThinkingBlock = {
  type: BlockType.thinking;
  thinking: string;
  signature: string;
};

// `input` keys are typed per tool in tool-results; `caller` is `{ type: "direct" }` in s1.
export type ToolUseBlock = {
  type: BlockType.tool_use;
  id: Uuid;
  name: string;
  input: Record<string, unknown>;
  caller: { type: string };
};

export type ToolResultBlock = {
  type: BlockType.tool_result;
  tool_use_id: Uuid;
  content: string;
  is_error: boolean;
};

// A pasted image in a user turn; no consumer reads it, so it only needs to parse.
export type ImageBlock = {
  type: BlockType.image;
  source: { type: string; data: string; media_type: string };
};

export type ContentBlock =
    | TextBlock
    | ThinkingBlock
    | ToolUseBlock
    | ToolResultBlock
    | ImageBlock;

// Thrown when a content block has a `type` outside the s1 vocabulary, so unmodeled shapes cannot pass silently.
export class UnknownContentBlockTypeError extends Error {
  readonly blockType: string;

  constructor(blockType: string) {
    super(`Unknown content block type: ${blockType}`);
    this.name = "UnknownContentBlockTypeError";
    this.blockType = blockType;
  }
}

const KNOWN_BLOCK_TYPE_SET = new Set<string>(KNOWN_CONTENT_BLOCK_TYPES);

function isKnownContentBlockType(value: unknown): value is BlockType {
  if (typeof value !== "string") {
    return false;
  }
  return KNOWN_BLOCK_TYPE_SET.has(value);
}

// Wrap tool-use and tool-result id strings in Uuid, returning a fresh block so the raw record stays unmutated.
function convertBlockIds(block: Record<string, unknown>): ContentBlock {
  if (block.type === BlockType.tool_use) {
    return { ...block, id: new Uuid(String(block.id)) } as ContentBlock;
  }
  if (block.type === BlockType.tool_result) {
    return {
      ...block,
      tool_use_id: new Uuid(String(block.tool_use_id)),
    } as ContentBlock;
  }
  return block as ContentBlock;
}

function parseContentBlock(raw: unknown): ContentBlock {
  const block = raw as Record<string, unknown> & { type?: unknown };
  const isKnownType = isKnownContentBlockType(block.type);
  if (!isKnownType) {
    throw new UnknownContentBlockTypeError(String(block.type));
  }
  return convertBlockIds(block);
}

// Hydrated blocks cached per record: callers only read them, and re-hydrating was the largest CPU cost.
const hydratedBlocksByRecord = new WeakMap<TranscriptRecord, ContentBlock[]>();

function collectContentBlocks(record: TranscriptRecord): ContentBlock[] {
  const message = record.message as { content?: unknown } | undefined;
  if (!message) {
    return [];
  }
  const content = message.content;
  const hasContentArray = Array.isArray(content);
  if (!hasContentArray) {
    return [];
  }
  const blocks: ContentBlock[] = [];
  for (const raw of content) {
    blocks.push(parseContentBlock(raw));
  }
  return blocks;
}

// Typed content blocks of a record, or [] without content; throws on unknown types. Read-only.
export function getContentBlocks(record: TranscriptRecord): ContentBlock[] {
  const cached = hydratedBlocksByRecord.get(record);
  if (cached !== undefined) {
    return cached;
  }
  const blocks = collectContentBlocks(record);
  hydratedBlocksByRecord.set(record, blocks);
  return blocks;
}

