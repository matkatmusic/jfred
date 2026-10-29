import type { TranscriptRecord } from "./envelope.ts";
import { getContentBlocks } from "./content-blocks.ts";
import { BlockType, ToolName } from "./vocabulary.ts";
import {
  convertEditResult,
  convertReadResult,
  convertWriteResult,
  type BashResult,
  type EditResult,
  type ReadResult,
  type WriteResult,
} from "./tool-result-shapes.ts";

export type ResolvedToolResult =
    | { toolName: ToolName.Bash; result: BashResult }
    | { toolName: ToolName.Write; result: WriteResult }
    | { toolName: ToolName.Read; result: ReadResult }
    | { toolName: ToolName.Edit; result: EditResult };

// Thrown for a tool name this code does not know, so an unknown tool cannot pass silently.
export class UnknownToolNameError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Unknown tool name: ${toolName}`);
    this.name = "UnknownToolNameError";
    this.toolName = toolName;
  }
}

function addToolUseNames(
  record: TranscriptRecord,
  nameById: Map<string, string>,
): void {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_use) {
      nameById.set(block.id.toString(), block.name);
    }
  }
}

// Map each tool_use id to its tool name, so a tool result can find its tool.
export function buildToolUseNamesById(
  records: TranscriptRecord[],
): Map<string, string> {
  const nameById = new Map<string, string>();
  for (const record of records) {
    addToolUseNames(record, nameById);
  }
  return nameById;
}

// The ids of tool_use blocks whose tool_result has is_error true. These calls changed no file.
export function collectErroredToolUseIds(
  records: TranscriptRecord[],
): Set<string> {
  const erroredIds = new Set<string>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_result) {
        continue;
      }
      const isErrored = block.is_error === true;
      if (isErrored) {
        erroredIds.add(block.tool_use_id.toString());
      }
    }
  }
  return erroredIds;
}

// The tool name behind this record's tool_result block, or undefined when it has none.
export function findToolNameForRecord(
  record: TranscriptRecord,
  nameById: Map<string, string>,
): string | undefined {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_result) {
      return nameById.get(block.tool_use_id.toString());
    }
  }
  return undefined;
}

function getTypedToolResult(toolName: string, raw: unknown): ResolvedToolResult {
  if (toolName === ToolName.Bash) {
    return { toolName: ToolName.Bash, result: raw as BashResult };
  }
  if (toolName === ToolName.Write) {
    return { toolName: ToolName.Write, result: convertWriteResult(raw) };
  }
  if (toolName === ToolName.Read) {
    return { toolName: ToolName.Read, result: convertReadResult(raw) };
  }
  if (toolName === ToolName.Edit) {
    return { toolName: ToolName.Edit, result: convertEditResult(raw) };
  }
  throw new UnknownToolNameError(toolName);
}

// Type the tool result of a user record, or undefined when none can be resolved.
export function getToolResultForUserRecord(
  record: TranscriptRecord,
  nameById: Map<string, string>,
): ResolvedToolResult | undefined {
  const raw = record.toolUseResult;
  if (!raw) {
    return undefined;
  }
  // An errored or rejected run reports a plain string: nothing to type.
  if (typeof raw === "string") {
    return undefined;
  }
  const toolName = findToolNameForRecord(record, nameById);
  if (toolName === undefined) {
    return undefined;
  }
  return getTypedToolResult(toolName, raw);
}
