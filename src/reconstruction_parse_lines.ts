// Gives each raw transcript line a verdict: kept or ignored. It does not feed reconstruction.

import { readFileSync } from "node:fs";
import { Path } from "./structures/domain.ts";
import { parseRecord } from "./parse/parseRecord.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import { BlockType, RecordType, ToolName, Verdict } from "./structures/vocabulary.ts";
import { getUserEditEvent } from "./reconstruction_user_edit.ts";
import {
  parseCpPaths,
  parseMvPaths,
  parseRedirect,
  parseRmTargets,
} from "./reconstruction_bash_events.ts";

// True when a bash command is a file op (rm, mv, cp, redirect) that gives an event.
function isBashCommandFileOp(command: string): boolean {
  return (
    parseRmTargets(command).length > 0 ||
        parseMvPaths(command) !== undefined ||
        parseCpPaths(command) !== undefined ||
        parseRedirect(command) !== undefined
  );
}

// The verdict of one tool_use block: Write and Edit by name, Bash by its command. Other tools give undefined.
function getToolUseVerdict(block: ToolUseBlock): Verdict | undefined {
  if (block.name === ToolName.Write) {
    return Verdict.write;
  }
  if (block.name === ToolName.Edit) {
    return Verdict.edit;
  }
  if (block.name === ToolName.Bash) {
    const command = (block.input as { command?: string }).command ?? "";
    return isBashCommandFileOp(command) ? Verdict.bashFileOp : Verdict.ignore;
  }
  return undefined;
}

// The verdict of the first file-affecting tool_use in a record, or undefined when it has none.
function scanToolUseVerdict(record: TranscriptRecord): Verdict | undefined {
  for (const block of getContentBlocks(record)) {
    if (block.type !== BlockType.tool_use) {
      continue;
    }
    const verdict = getToolUseVerdict(block);
    if (verdict !== undefined) {
      return verdict;
    }
  }
  return undefined;
}

// Whether a `toolUseResult` is a Read result with file content, found under `file.content`.
function isReadResult(result: Record<string, unknown>): boolean {
  const file = result.file as { content?: unknown } | undefined;
  return typeof file?.content === "string";
}

// Whether a `toolUseResult` is an Edit result. The old and new strings tell it apart from a Write result.
function isEditResult(result: Record<string, unknown>): boolean {
  return (
    Array.isArray(result.structuredPatch) &&
        typeof result.oldString === "string" &&
        typeof result.newString === "string"
  );
}

// The verdict of a record's `toolUseResult`: read-beacon for Read, edit-result for Edit, undefined for Write and Bash.
function getResultVerdict(record: TranscriptRecord): Verdict | undefined {
  const result = record.toolUseResult as Record<string, unknown> | undefined;
  if (!result) {
    return undefined;
  }
  if (isReadResult(result)) {
    return Verdict.readBeacon;
  }
  if (isEditResult(result)) {
    return Verdict.editResult;
  }
  return undefined;
}

// The verdict of a parsed record: snapshot, user edit, tool_use, then tool result. Extraction uses this same decision.
export function getRecordVerdict(record: TranscriptRecord): Verdict {
  if (record.type === RecordType.fileHistorySnapshot) {
    return Verdict.fileHistorySnapshot;
  }
  if (getUserEditEvent(record) !== undefined) {
    return Verdict.userEdit;
  }
  return scanToolUseVerdict(record) ?? getResultVerdict(record) ?? Verdict.ignore;
}

// The verdict of one raw JSONL line. Anything unclassified, or any line that throws, is `ignore`.
export function getLineVerdict(rawLine: string): Verdict {
  try {
    return getRecordVerdict(parseRecord(rawLine));
  }
  catch {
    return Verdict.ignore;
  }
}

// --- partition --------------------------------------------------------------------------------------

// A kept line: its 1-based line number, its verdict, and its raw text. An ignored line has no verdict.
export type KeptLine = {
  lineNumber: number;
  verdict: Verdict;
  raw: string;
};

export type IgnoredLine = {
  lineNumber: number;
  raw: string;
};

export type LinePartition = {
  kept: KeptLine[];
  ignored: IgnoredLine[];
};

// Read a transcript and split it into kept and ignored lines, numbered from 1. Blank lines are dropped.
export function splitTranscriptLines(jsonl: Path): LinePartition {
  const lines = readFileSync(jsonl.toString(), "utf8").split("\n");
  const kept: KeptLine[] = [];
  const ignored: IgnoredLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (raw.length === 0) {
      continue;
    }
    const lineNumber = index + 1;
    const verdict = getLineVerdict(raw);
    if (verdict === Verdict.ignore) {
      ignored.push({ lineNumber, raw });
      continue;
    }
    kept.push({ lineNumber, verdict, raw });
  }
  return { kept, ignored };
}

