// The document's toolCalls[] (item 55): every non-file-edit tool call in the transcript, for the
// timeline's un-bubbled `* <summary> * [{ }] <TS> L:n` rows. Two sources: tool_use blocks from
// assistant records, and the rewritten command a PreToolUse hook actually ran when it differs
// from the tool_use's own command (s39's rtk-rewrite hook turns `ls …` into `rtk ls …` — both
// rows render). Write/Edit calls are represented as file chips, never rows.

import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { getAttachmentEntry } from "./structures/session-meta.ts";
import { collectOrphanedUuids } from "./reconstruction_orphans.ts";

// One tool call, parsed for the timeline: the tool's name, a one-line summary of what it did
// (command / file path / pattern), when and which session ran it (for chronological placement),
// the record's own uuid (the viewer resolves the row's JSONL line through it), and the tool_use
// id (hook attachments and tool_results carry it verbatim, so the inspector's raw-line sync can
// map those lines back to the row).
export type ToolCall = {
    toolName: string;
    summary: string;
    timestamp: Date;
    sessionId: Uuid | undefined;
    uuid: Uuid;
    toolUseId: Uuid;
    // True when the call's record sits on a rewound (abandoned) conversation branch — the
    // timeline dims its row alongside the branch's turns (collectOrphanedUuids).
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
    const firstStringValue = Object.values(input).find((value) => typeof value === "string");
    if (typeof firstStringValue === "string") {
        return firstStringValue;
    }
    return "";
}

// The rewritten command inside a hook attachment's stdout, or undefined when the attachment is
// not a command rewrite (hook-run attachments like SessionStart/Stop have no updatedInput).
function parseHookRewrittenCommand(stdout: unknown): string | undefined {
    if (typeof stdout !== "string") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        return undefined;
    }
    const hookOutput = (parsed as { hookSpecificOutput?: { updatedInput?: { command?: unknown } } }).hookSpecificOutput;
    const command = hookOutput?.updatedInput?.command;
    if (typeof command !== "string") {
        return undefined;
    }
    return command;
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

// Every non-file-edit tool call in the transcript, in record order: pass 1 emits tool_use rows
// and indexes every block's summary by toolUseId; pass 2 emits one extra row per PreToolUse
// command rewrite whose command differs from the tool_use's own.
export function findToolCalls(records: TranscriptRecord[]): ToolCall[] {
    const orphanedUuids = collectOrphanedUuids(records);
    const calls: ToolCall[] = [];
    const summaryByToolUseId = new Map<string, string>();
    for (const record of records) {
        const timestamp = record.timestamp;
        if (!(timestamp instanceof Date)) continue;
        // A record without its own uuid has no line the row's label/{ } button could resolve.
        const recordUuid = record.uuid;
        if (!(recordUuid instanceof Uuid)) continue;
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use) continue;
            const summary = computeToolCallSummary(block);
            summaryByToolUseId.set(block.id.toString(), summary);
            if (FILE_EDIT_TOOL_NAMES.has(block.name)) continue;
            appendToolUseRow(calls, block, summary, timestamp, record.sessionId, recordUuid, orphanedUuids);
        }
    }
    // ponytail: only command rewrites get extra rows; input rewrites of non-command tools stay
    // invisible until a scenario needs them.
    const rewrittenToolUseIds = new Set<string>();
    for (const record of records) {
        const entry = getAttachmentEntry(record);
        if (entry === undefined) continue;
        const toolUseId = entry.attachment.toolUseID;
        if (typeof toolUseId !== "string") continue;
        if (rewrittenToolUseIds.has(toolUseId)) continue;
        const rewrittenCommand = parseHookRewrittenCommand(entry.attachment.stdout);
        if (rewrittenCommand === undefined) continue;
        if (rewrittenCommand === summaryByToolUseId.get(toolUseId)) continue;
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

