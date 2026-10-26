import type { ToolUseBlock } from "./content-blocks.ts";
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

// Turn a Write result's filePath string into a Path. Other fields stay as they are.
export function convertWriteResult(raw: unknown): WriteResult {
  const result = raw as WriteResult & { filePath: string };
  return { ...result, filePath: new Path(result.filePath) };
}

// Turn a Read result's file.filePath into a Path. It returns a new object and leaves the raw record unchanged.
export function convertReadResult(raw: unknown): ReadResult {
  const result = raw as ReadResult & { file: ReadFile & { filePath: string } };
  return {
    ...result,
    file: { ...result.file, filePath: new Path(result.file.filePath) },
  };
}

// Hydrate an Edit result's filePath into a Path; structuredPatch and the before/after strings are free-form values carried through unchanged.
export function convertEditResult(raw: unknown): EditResult {
  const result = raw as EditResult & { filePath: string };
  return { ...result, filePath: new Path(result.filePath) };
}
