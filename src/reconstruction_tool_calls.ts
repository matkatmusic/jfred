// Every non-file-edit tool call in the transcript, as timeline rows: tool_use blocks plus hook-rewritten commands.

import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { getAttachmentEntry } from "./structures/session-meta.ts";
import { collectOrphanedUuids } from "./reconstruction_orphans.ts";

// One tool call parsed for the timeline: name, summary, time, session, record uuid, and tool_use id.
export type ToolCall = {
  toolName: string;
  summary: string;
  timestamp: Date;
  sessionId: Uuid | undefined;
  uuid: Uuid;
  toolUseId: Uuid;
  // True when the call's record sits on a rewound conversation branch.
  isOrphaned: boolean;
};

// The tools whose calls render as file chips (with { } / +/- buttons), never as tool rows.
const FILE_EDIT_TOOL_NAMES = new Set<string>([ToolName.Write, ToolName.Edit]);

// A tool_use block's one-line summary, picking the most command-like input field.
export function computeToolCallSummary(block: { input: unknown }): string {
  const input = block.input as Record<string, unknown>;
  if (typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.file_path === "string") {
    return input.file_path;
  }
  if (typeof input.pattern === "string") {
    return input.pattern;
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

// The rewritten command in a hook attachment's stdout, or undefined when it is not a rewrite.
function parseHookRewrittenCommand(stdout: unknown): string | undefined {
  if (typeof stdout !== "string") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  }
  catch {
    return undefined;
  }
  const hookOutput = (parsed as { hookSpecificOutput?: { updatedInput?: { command?: unknown } } }).hookSpecificOutput;
  const command = hookOutput?.updatedInput?.command;
  return typeof command === "string" ? command : undefined;
}

// The tool name a hook ran for, from its hookName's suffix ("PreToolUse:Bash" -> "Bash").
function parseHookToolName(hookName: unknown): string {
  if (typeof hookName !== "string") {
    return "";
  }
  const separatorIndex = hookName.lastIndexOf(":");
  if (separatorIndex < 0) {
    return hookName;
  }
  return hookName.slice(separatorIndex + 1);
}

// Appends the tool_use block's timeline row to calls.
function appendToolUseRow(
  calls: ToolCall[],
  block: { name: string; id: Uuid },
  summary: string,
  timestamp: Date,
  sessionId: Uuid | undefined,
  recordUuid: Uuid,
  orphanedUuids: Set<string>,
): void {
  calls.push({
    toolName: block.name,
    summary,
    timestamp,
    sessionId,
    uuid: recordUuid,
    toolUseId: block.id,
    isOrphaned: orphanedUuids.has(recordUuid.toString()),
  });
}

// Tool calls in record order: tool_use rows first, then one extra row per differing hook rewrite.
export function findToolCalls(records: TranscriptRecord[]): ToolCall[] {
  const orphanedUuids = collectOrphanedUuids(records);
  const calls: ToolCall[] = [];
  const summaryByToolUseId = new Map<string, string>();
  for (const record of records) {
    const timestamp = record.timestamp;
    if (!(timestamp instanceof Date))
      continue;
    // A record without its own uuid has no line the row's label/{ } button could resolve.
    const recordUuid = record.uuid;
    if (!(recordUuid instanceof Uuid))
      continue;
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_use)
        continue;
      const summary = computeToolCallSummary(block);
      summaryByToolUseId.set(block.id.toString(), summary);
      const isFileEditTool = FILE_EDIT_TOOL_NAMES.has(block.name);
      if (isFileEditTool)
        continue;
      appendToolUseRow(calls, block, summary, timestamp, record.sessionId, recordUuid, orphanedUuids);
    }
  }
  // ponytail: only command rewrites get extra rows; input rewrites of non-command tools stay invisible until a scenario needs them.
  const rewrittenToolUseIds = new Set<string>();
  for (const record of records) {
    const entry = getAttachmentEntry(record);
    if (entry === undefined)
      continue;
    const toolUseId = entry.attachment.toolUseID;
    if (typeof toolUseId !== "string")
      continue;
    const isAlreadyRewritten = rewrittenToolUseIds.has(toolUseId);
    if (isAlreadyRewritten)
      continue;
    const rewrittenCommand = parseHookRewrittenCommand(entry.attachment.stdout);
    if (rewrittenCommand === undefined)
      continue;
    const originalSummary = summaryByToolUseId.get(toolUseId);
    if (rewrittenCommand === originalSummary)
      continue;
    rewrittenToolUseIds.add(toolUseId);
    calls.push({
      toolName: parseHookToolName(entry.attachment.hookName),
      summary: rewrittenCommand,
      timestamp: entry.timestamp,
      sessionId: entry.sessionId,
      uuid: entry.uuid,
      toolUseId: new Uuid(toolUseId),
      isOrphaned: orphanedUuids.has(entry.uuid.toString()),
    });
  }
  return calls;
}

