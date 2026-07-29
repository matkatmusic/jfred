// Extraction: transcript records to ordered file events.

import { getContentBlocks } from "./structures/content-blocks.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import {
    indexToolUseNamesById,
    type EditResult,
    type StructuredPatchHunk,
} from "./structures/tool-results.ts";
import { BlockType, EventKind, ToolName, Verdict } from "./structures/vocabulary.ts";
import { recordVerdict } from "./reconstruction_parse_lines.ts";
import { Path } from "./structures/domain.ts";
import type {
    EditEvent,
    FileEvent,
    WriteEvent,
} from "./reconstruction_engine.ts";
import { bashEventsFrom } from "./reconstruction_bash_events.ts";
import { extractScriptRenameEvents } from "./reconstruction_script_renames.ts";
import { userEditEventFrom } from "./reconstruction_user_edit.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";

// Turn a Write tool_use into a write event (file_path/content live in its input).
function writeEventFrom(block: ToolUseBlock, timestamp: Date): WriteEvent {
    const input = block.input as { file_path: string; content: string };
    return {
        kind: EventKind.write,
        changeId: block.id,
        target: new Path(input.file_path),
        content: input.content,
        timestamp,
    };
}

// The per-Edit detail from its result record: structuredPatch hunks + the literal pre-edit content.
type EditDetail = { hunks: StructuredPatchHunk[]; originalFile: string };

// Build an edit event from its structuredPatch detail, if available.
function editEventFrom(
    block: ToolUseBlock,
    timestamp: Date,
    detailById: Map<string, EditDetail>,
): EditEvent | undefined {
    const input = block.input as { file_path: string };
    const detail = detailById.get(block.id.toString());
    if (!detail) {
        return undefined;
    }
    return {
        kind: EventKind.edit,
        changeId: block.id,
        target: new Path(input.file_path),
        hunks: detail.hunks,
        originalFile: detail.originalFile,
        timestamp,
    };
}

// Map a tool_use block to file events based on tool type.
function toFileEvents(
    block: ToolUseBlock,
    timestamp: Date,
    detailById: Map<string, EditDetail>,
    cwd: Path | undefined,
): FileEvent[] {
    if (block.name === ToolName.Write) {
        const e = writeEventFrom(block, timestamp);
        return e ? [e] : [];
    }
    if (block.name === ToolName.Bash) {
        return bashEventsFrom(block, timestamp, cwd);
    }
    if (block.name === ToolName.Edit) {
        const e = editEventFrom(block, timestamp, detailById);
        return e ? [e] : [];
    }
    return [];
}

function collectEventsFromRecord(
    record: TranscriptRecord,
    events: FileEvent[],
    detailById: Map<string, EditDetail>,
): void {
    // Skip records the classifier marks as `ignore`.
    if (recordVerdict(record) === Verdict.ignore) {
        return;
    }
    const timestamp = record.timestamp;
    if (!(timestamp instanceof Date)) {
        return;
    }
    const cwd = (record as { cwd?: Path }).cwd;
    for (const block of getContentBlocks(record)) {
        if (block.type !== BlockType.tool_use) {
            continue;
        }
        events.push(...toFileEvents(block, timestamp, detailById, cwd));
    }
    const userEdit = userEditEventFrom(record);
    if (userEdit) {
        events.push(userEdit);
    }
}

// Index each Edit result's hunks and pre-edit content by tool_use id.
function indexEditDetailByToolUseId(
    records: TranscriptRecord[],
): Map<string, EditDetail> {
    const nameById = indexToolUseNamesById(records);
    const detailById = new Map<string, EditDetail>();
    for (const record of records) {
        collectEditDetailFromRecord(record, nameById, detailById);
    }
    return detailById;
}

function collectEditDetailFromRecord(
    record: TranscriptRecord,
    nameById: Map<string, string>,
    detailById: Map<string, EditDetail>,
): void {
    for (const block of getContentBlocks(record)) {
        if (block.type !== BlockType.tool_result) {
            continue;
        }
        const toolName = nameById.get(block.tool_use_id.toString());
        if (toolName !== ToolName.Edit) {
            continue;
        }
        const result = record.toolUseResult as EditResult | undefined;
        // Require structuredPatch — an Edit result lacking it produced no event before; don't build a hunkless edit.
        if (result && result.structuredPatch) {
            detailById.set(block.tool_use_id.toString(), { hunks: result.structuredPatch, originalFile: result.originalFile });
        }
    }
}

// Extract all file events from the transcript, memoized per corpus identity.
export function extractFileEvents(records: TranscriptRecord[]): FileEvent[] {
    const state = getCorpusState(records);
    if (state.fileEvents !== undefined) {
        return state.fileEvents;
    }
    const detailById = indexEditDetailByToolUseId(records);
    const events: FileEvent[] = [];
    for (const record of records) {
        collectEventsFromRecord(record, events, detailById);
    }
    events.push(...extractScriptRenameEvents(records));
    state.fileEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return state.fileEvents;
}
