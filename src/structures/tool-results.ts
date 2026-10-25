import type { TranscriptRecord } from "./envelope.ts";
import { getContentBlocks, type ToolUseBlock } from "./content-blocks.ts";
import { BlockType, ToolName } from "./vocabulary.ts";
import { Path } from "./domain.ts";

// Shapes of tool_use.input. No code builds them yet, so they are only declared.
export type BashInput = { command: string; description: string };
export type WriteInput = { content: string; file_path: Path };
export type ReadInput = { file_path: Path };
export type EditInput = {
  file_path: Path;
  old_string: string;
  new_string: string;
  replace_all: boolean;
};

// Newer transcripts record a Write input as { path, file_text }; some mix the two shapes key by key.
export function readWriteInput(block: ToolUseBlock): { filePath: Path; content: string } {
  const input = block.input as { file_path?: string; path?: string; content?: string; file_text?: string };
  const filePath = input.file_path ?? input.path;
  const content = input.content ?? input.file_text;
  if (filePath === undefined || content === undefined) {
    throw new Error(`Write tool_use ${block.id.toString()} has no path/content in its input`);
  }
  return { filePath: new Path(filePath), content };
}

// toolUseResult shapes (recon/07, recon/09).
export type BashResult = {
  interrupted: boolean;
  isImage: boolean;
  noOutputExpected: boolean;
  stderr: string;
  stdout: string;
};

// One diff hunk inside a structuredPatch. Line ranges are plain numbers; `lines` is the raw diff text.
export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type WriteResult = {
  content: string;
  filePath: Path;
  originalFile: string | null;
  structuredPatch: StructuredPatchHunk[];
  type: string;
  userModified: boolean;
};

// A Read result keeps the file content and line counts in a nested `file` object.
export type ReadFile = {
  filePath: Path;
  content: string;
  numLines: number;
  startLine: number;
  totalLines: number;
};

export type ReadResult = {
  type: string;
  file: ReadFile;
};

// An Edit result holds the old and new strings and a structuredPatch. The originalFile can be null.
export type EditResult = {
  filePath: Path;
  oldString: string;
  newString: string;
  originalFile: string | null;
  structuredPatch: StructuredPatchHunk[];
  userModified: boolean;
  replaceAll: boolean;
};

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
      if (block.type === BlockType.tool_result && block.is_error === true) {
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

// Turn a Write result's filePath string into a Path. Other fields stay as they are.
function convertWriteResult(raw: unknown): WriteResult {
  const result = raw as WriteResult & { filePath: string };
  return { ...result, filePath: new Path(result.filePath) };
}

// Turn a Read result's file.filePath into a Path. It returns a new object and leaves the raw record unchanged.
function convertReadResult(raw: unknown): ReadResult {
  const result = raw as ReadResult & { file: ReadFile & { filePath: string } };
  return {
    ...result,
    file: { ...result.file, filePath: new Path(result.file.filePath) },
  };
}

// Hydrate an Edit result's filePath into a Path; structuredPatch and the before/after strings are free-form values carried through unchanged.
function convertEditResult(raw: unknown): EditResult {
  const result = raw as EditResult & { filePath: string };
  return { ...result, filePath: new Path(result.filePath) };
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

// Resolve and type the tool result attached to a user record, or undefined when the record carries no toolUseResult, no resolvable tool name, or an errored run.
export function getToolResultForUserRecord(
  record: TranscriptRecord,
  nameById: Map<string, string>,
): ResolvedToolResult | undefined {
  const raw = record.toolUseResult;
  if (!raw) {
    return undefined;
  }
  // An errored or rejected run reports a plain string ("Error: File does not exist.", "User rejected tool use") instead of a structured payload — nothing to type.
  if (typeof raw === "string") {
    return undefined;
  }
  const toolName = findToolNameForRecord(record, nameById);
  if (toolName === undefined) {
    return undefined;
  }
  return getTypedToolResult(toolName, raw);
}

