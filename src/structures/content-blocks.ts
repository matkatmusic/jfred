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

// `input` is an object whose per-tool key shape is typed in tool-results.  `caller` is `{ type: "direct" }` in s1; modeled as the present field only.
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

// A pasted image in a user turn. Payload kept as observed on the wire; no consumer reads it — every getContentBlocks caller filters to a specific BlockType member, so image blocks only need to parse, not be handled.
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

// Thrown when a content block carries a `type` outside the s1 vocabulary, so an unmodeled block shape cannot pass silently (fog-of-war guard).
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

// Hydrate the id fields of a block from their wire strings into Uuid objects, so tool-use and tool-result ids are domain objects, not primitives. Returns a fresh object so the underlying raw record is never mutated — getContentBlocks runs repeatedly over the same record, and in-place mutation would re-wrap an already-hydrated id.
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

// Hydrated blocks per record identity (the loadTranscript.ts recordSources precedent): hydration never mutates the raw record and every caller only reads the result, so one hydration per record serves all callers. Re-hydrating on every call was the single largest CPU cost of a document build (~58% of samples on a 33-session project).
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

// Return the typed content blocks of a record's message, or [] when the record carries no message.content array (e.g. session-meta records). Throws on any block whose type is outside the s1 vocabulary. The result is hydrated once per record and shared — callers must treat it as read-only.
export function getContentBlocks(record: TranscriptRecord): ContentBlock[] {
    const cached = hydratedBlocksByRecord.get(record);
    if (cached !== undefined) {
        return cached;
    }
    const blocks = hydrateContentBlocks(record);
    hydratedBlocksByRecord.set(record, blocks);
    return blocks;
}

