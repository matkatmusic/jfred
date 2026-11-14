// One log record to one dot's kind, label and pair id (task 888).
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

export type RecordDotDescription = { kind: WireRecordKind; label: string; pairId: Uuid | undefined };
type RawBlock = { type?: unknown; id?: unknown; name?: unknown; tool_use_id?: unknown; content?: unknown; text?: unknown };

const DOT_LABEL_LIMIT = 80;
const PLAIN_KIND_BY_RECORD_TYPE = new Map<RecordType, WireRecordKind>([
  [RecordType.attachment, WireRecordKind.attachment],
  [RecordType.permissionMode, WireRecordKind.permissionMode],
  [RecordType.customTitle, WireRecordKind.customTitle],
]);

function readRawContent(record: TranscriptRecord): unknown {
  const message = record.message as { content?: unknown } | null | undefined;
  return message?.content;
}

// Raw blocks, not getContentBlocks: that throws on a block type outside the seven known ones.
function listRawBlocks(record: TranscriptRecord): RawBlock[] {
  const content = readRawContent(record);
  const isBlockList = Array.isArray(content);
  if (isBlockList) {
    return content as RawBlock[];
  }
  return [];
}

function findFirstRawBlock(record: TranscriptRecord, blockType: BlockType): RawBlock | undefined {
  for (const block of listRawBlocks(record)) {
    if (block.type === blockType) {
      return block;
    }
  }
  return undefined;
}

function joinTextBlocks(blocks: RawBlock[]): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === BlockType.text) {
      texts.push(String(block.text));
    }
  }
  return texts.join("\n");
}

// A string as is, else the text parts joined by a newline.
function readRawText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const isPartList = Array.isArray(content);
  if (isPartList) {
    return joinTextBlocks(content as RawBlock[]);
  }
  return "";
}

function trimLabel(text: string): string {
  return text.slice(0, DOT_LABEL_LIMIT);
}

function readAssistantDotDescription(record: TranscriptRecord): RecordDotDescription {
  const toolUse = findFirstRawBlock(record, BlockType.tool_use);
  if (toolUse !== undefined) {
    return { kind: WireRecordKind.toolUse, label: String(toolUse.name), pairId: new Uuid(String(toolUse.id)) };
  }
  const label = trimLabel(readRawText(readRawContent(record)));
  return { kind: WireRecordKind.assistant, label, pairId: undefined };
}

function readUserDotDescription(record: TranscriptRecord): RecordDotDescription {
  const toolResult = findFirstRawBlock(record, BlockType.tool_result);
  if (toolResult !== undefined) {
    const label = trimLabel(readRawText(toolResult.content));
    return { kind: WireRecordKind.toolResult, label, pairId: new Uuid(String(toolResult.tool_use_id)) };
  }
  const label = trimLabel(readRawText(readRawContent(record)));
  return { kind: WireRecordKind.user, label, pairId: undefined };
}

export function readRecordDotDescription(record: TranscriptRecord): RecordDotDescription {
  if (record.type === RecordType.assistant) {
    return readAssistantDotDescription(record);
  }
  if (record.type === RecordType.user) {
    return readUserDotDescription(record);
  }
  const plainKind = PLAIN_KIND_BY_RECORD_TYPE.get(record.type) ?? WireRecordKind.unknown;
  return { kind: plainKind, label: record.type, pairId: undefined };
}
