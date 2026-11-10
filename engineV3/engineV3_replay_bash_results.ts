// Pairs each recorded Bash call with its time window and result, and spots the calls that never ran.

import { getContentBlocks } from "../src/structures/content-blocks.ts";
import type { Uuid } from "../src/structures/domain.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";

export type BashCallResult = { toolUseId: Uuid; startMs: number; endMs: number; isError: boolean; resultText: string };

type BashCallStart = { toolUseId: Uuid; startMs: number };

const NEVER_RAN_PREFIXES = [
  "PreToolUse:Bash hook error",
  "The server-side auto mode classifier",
  "Permission for this action was denied by the Claude Code auto mode classifier",
  "This agent is isolated in the worktree",
  "<tool_use_error>Blocked",
];

function addBashCallStarts(line: JSONLLine, startMs: number, starts: Map<string, BashCallStart>): void {
  for (const block of getContentBlocks(line)) {
    if (block.type === BlockType.tool_use) {
      if (block.name === ToolName.Bash) {
        starts.set(block.id.toString(), { toolUseId: block.id, startMs });
      }
    }
  }
}

function collectBashCallStarts(lines: JSONLLine[]): Map<string, BashCallStart> {
  const starts = new Map<string, BashCallStart>();
  for (const line of lines) {
    if (line.timestamp instanceof Date) {
      addBashCallStarts(line, line.timestamp.getTime(), starts);
    }
  }
  return starts;
}

// The block content is a string or a list of text blocks at runtime, though ToolResultBlock types it as a string.
function getResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const texts: string[] = [];
  for (const part of content as { type: string; text: string }[]) {
    if (part.type === BlockType.text) {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

function addBashCallResults(line: JSONLLine, endMs: number, starts: Map<string, BashCallStart>, results: Map<string, BashCallResult>): void {
  for (const block of getContentBlocks(line)) {
    if (block.type === BlockType.tool_result) {
      const start = starts.get(block.tool_use_id.toString());
      if (start !== undefined) {
        const isError = block.is_error === true;
        results.set(start.toolUseId.toString(), { ...start, endMs, isError, resultText: getResultText(block.content) });
      }
    }
  }
}

// Keyed by tool_use id text; a Bash call with no result line, or a line with no timestamp, is left out.
export function collectBashCallResults(lines: JSONLLine[]): Map<string, BashCallResult> {
  const starts = collectBashCallStarts(lines);
  const results = new Map<string, BashCallResult>();
  for (const line of lines) {
    if (line.timestamp instanceof Date) {
      addBashCallResults(line, line.timestamp.getTime(), starts, results);
    }
  }
  return results;
}

// True when the recorded error says the command was blocked before it ran.
export function isNeverRanResult(result: BashCallResult): boolean {
  if (!result.isError) {
    return false;
  }
  for (const prefix of NEVER_RAN_PREFIXES) {
    const hasPrefix = result.resultText.startsWith(prefix);
    if (hasPrefix) {
      return true;
    }
  }
  return false;
}
