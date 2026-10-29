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

// `input` keys are typed per tool in tool-results; `caller` is modeled as the field present on the wire.
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

// A pasted image in a user turn. Callers filter by BlockType, so image blocks only need to parse.
export type ImageBlock = {
  type: BlockType.image;
  source: { type: string; data: string; media_type: string };
};

// The Advisor tool's call block. It changes no files, so no consumer reads it.
export type ServerToolUseBlock = {
  type: BlockType.server_tool_use;
  id: string;
  name: string;
  input: Record<string, unknown>;
};

// The Advisor tool's result block. Payload kept as observed on the wire; no consumer reads it.
export type AdvisorToolResultBlock = {
  type: BlockType.advisor_tool_result;
  tool_use_id: string;
  content: { type: string; encrypted_content: string };
};

export type ContentBlock =
    | TextBlock
    | ThinkingBlock
    | ToolUseBlock
    | ToolResultBlock
    | ImageBlock
    | ServerToolUseBlock
    | AdvisorToolResultBlock;

// Thrown on a block `type` outside the known vocabulary, so unmodeled block shapes never pass silently.
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

// Wrap tool-use and tool-result id strings in Uuid objects, on a fresh copy so the raw record stays unmutated.
function hydrateBlockIds(block: Record<string, unknown>): ContentBlock {
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

function toContentBlock(raw: unknown): ContentBlock {
  const block = raw as Record<string, unknown> & { type?: unknown };
  if (!isKnownContentBlockType(block.type)) {
    throw new UnknownContentBlockTypeError(String(block.type));
  }
  return hydrateBlockIds(block);
}

// Hydrated blocks cached per record identity: callers only read them, and re-hydrating was the largest CPU cost.
const hydratedBlocksByRecord = new WeakMap<TranscriptRecord, ContentBlock[]>();

function hydrateContentBlocks(record: TranscriptRecord): ContentBlock[] {
  const message = record.message as { content?: unknown } | undefined;
  if (!message) {
    return [];
  }
  if (!Array.isArray(message.content)) {
    return [];
  }
  return message.content.map(toContentBlock);
}

// Return a record's typed content blocks, or []. Throws on unknown block types; result is read-only.
export function getContentBlocks(record: TranscriptRecord): ContentBlock[] {
  const cached = hydratedBlocksByRecord.get(record);
  if (cached !== undefined) {
    return cached;
  }
  const blocks = hydrateContentBlocks(record);
  hydratedBlocksByRecord.set(record, blocks);
  return blocks;
}

