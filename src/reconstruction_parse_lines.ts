// Step-1 line-partition parser (s37 script-replay diagnostic). Classify each raw JSONL line into a single `Verdict` and split the transcript into a kept / ignored partition. This is a PARALLEL DIAGNOSTIC: it observes the transcript but does not feed reconstruction. The planned Phase B ("kept[] becomes the engine's sole input") is RETIRED — gating at load regressed branch reconstruction (the engine walks the full last-prompt/parentUuid DAG), so extraction is gated per-record via `recordVerdict` instead and full records still flow to reconstructBranches. Classification reuses the same per-line decision logic extraction consumes, so the classifier cannot drift. The human-readable trace render lives in reconstruction_trace.ts (split out to keep each file within the 250-line cap). Design: ~/.claude/plans/task-implement-script-replay-partitioned-puppy.md (Phase A).

import { readFileSync } from "node:fs";
import { Path } from "./structures/domain.ts";
import { parseRecord } from "./parse/parseRecord.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import { BlockType, RecordType, ToolName, Verdict } from "./structures/vocabulary.ts";
import { userEditEventFrom } from "./reconstruction_user_edit.ts";
import {
    parseCpPaths,
    parseMvPaths,
    parseRedirect,
    parseRmTargets,
} from "./reconstruction_bash_events.ts";

// Whether a bash command is one of the file ops the engine extracts an event from (rm/mv/cp/redirect), as opposed to a non-file-op command (git status, pytest, …) that yields no event. Reuses the same parsers `bashEventFrom` uses, so a non-file-op bash line is correctly `ignore`d.
function bashCommandIsFileOp(command: string): boolean {
    return (
        parseRmTargets(command).length > 0 ||
        parseMvPaths(command) !== undefined ||
        parseCpPaths(command) !== undefined ||
        parseRedirect(command) !== undefined
    );
}

// The verdict a single tool_use block earns: Write/Edit by name; Bash by whether its command is a file op (non-file-op bash -> ignore); any other tool (e.g. an MCP ctx_execute) -> undefined here. The `scriptExecution` branch (the ctx_execute rename idiom) lands with C5's `isScriptRenameRun`.
function toolUseVerdict(block: ToolUseBlock): Verdict | undefined {
    if (block.name === ToolName.Write) {
        return Verdict.write;
    }
    if (block.name === ToolName.Edit) {
        return Verdict.edit;
    }
    if (block.name === ToolName.Bash) {
        const command = (block.input as { command?: string }).command ?? "";
        return bashCommandIsFileOp(command) ? Verdict.bashFileOp : Verdict.ignore;
    }
    return undefined;
}

// The verdict of the first file-affecting tool_use in a record, or undefined when it has none.
function scanToolUseVerdict(record: TranscriptRecord): Verdict | undefined {
    for (const block of getContentBlocks(record)) {
        if (block.type !== BlockType.tool_use) {
            continue;
        }
        const verdict = toolUseVerdict(block);
        if (verdict !== undefined) {
            return verdict;
        }
    }
    return undefined;
}

// Whether a user record's `toolUseResult` is a Read result carrying file content (a post-edit beacon the reseed stages read). The Read result nests content under `file.content` (tool-results.ts ReadResult).
function isReadResult(result: Record<string, unknown>): boolean {
    const file = result.file as { content?: unknown } | undefined;
    return typeof file?.content === "string";
}

// Whether a user record's `toolUseResult` is an Edit result (structuredPatch + before/after strings). The before/after strings distinguish it from a Write result, which also carries a structuredPatch.
function isEditResult(result: Record<string, unknown>): boolean {
    return (
        Array.isArray(result.structuredPatch) &&
        typeof result.oldString === "string" &&
        typeof result.newString === "string"
    );
}

// The verdict a record's `toolUseResult` earns: a Read result is a read-beacon, an Edit result is an edit-result; a Write/Bash result yields no verdict (the Write tool_use itself is the `write` line).
function resultVerdict(record: TranscriptRecord): Verdict | undefined {
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

// The verdict of a parsed record, in the order extraction reads it: a file-history-snapshot record, then a user-edit attachment, then a file-affecting tool_use, then a tool result (read-beacon / edit-result).  Exported so extraction gates event emission on the SAME decision (Phase B: evaluateLine is the sole keep/ignore gate for file evidence — see extractFileEvents).
export function recordVerdict(record: TranscriptRecord): Verdict {
    if (record.type === RecordType.fileHistorySnapshot) {
        return Verdict.fileHistorySnapshot;
    }
    if (userEditEventFrom(record) !== undefined) {
        return Verdict.userEdit;
    }
    return scanToolUseVerdict(record) ?? resultVerdict(record) ?? Verdict.ignore;
}

// Classify one raw JSONL line into a single Verdict. Anything not otherwise classified — prose, thinking, hooks, a Write/Bash result, a non-file-op bash — is `ignore`. A throw anywhere (bad JSON, unmodeled block) is treated as `ignore`: it cannot be evidence.
export function evaluateLine(rawLine: string): Verdict {
    try {
        return recordVerdict(parseRecord(rawLine));
    } catch {
        return Verdict.ignore;
    }
}

// --- partition --------------------------------------------------------------------------------------

// A kept line: its 1-based file line number, its verdict, and the raw line (retained for the on-demand detail render). An ignored line carries no verdict (it is `ignore` by definition).
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

// Read a transcript and split it into kept / ignored lines. `lineNumber` is the 1-based file line number (so it matches how the transcript is referenced everywhere else). Blank lines are dropped entirely.
export function partitionLines(jsonl: Path): LinePartition {
    const lines = readFileSync(jsonl.toString(), "utf8").split("\n");
    const kept: KeptLine[] = [];
    const ignored: IgnoredLine[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index]!;
        if (raw.length === 0) {
            continue;
        }
        const lineNumber = index + 1;
        const verdict = evaluateLine(raw);
        if (verdict === Verdict.ignore) {
            ignored.push({ lineNumber, raw });
            continue;
        }
        kept.push({ lineNumber, verdict, raw });
    }
    return { kept, ignored };
}

