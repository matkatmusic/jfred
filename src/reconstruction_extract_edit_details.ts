// Extraction: Edit tool results indexed by tool_use id, turned into edit events.

import { getContentBlocks } from "./structures/content-blocks.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { buildToolUseNamesById } from "./structures/tool-results.ts";
import type {
  EditResult,
  StructuredPatchHunk,
} from "./structures/tool-result-shapes.ts";
import { BlockType, EventKind, ToolName } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { EditEvent } from "./reconstruction_events.ts";

// The per-Edit detail from its result record: structuredPatch hunks + the literal pre-edit content.
export type EditDetail = { hunks: StructuredPatchHunk[]; originalFile: string | null };

// Build an edit event from its structuredPatch detail, if available.
export function createEditEvent(
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

// Index each Edit result's hunks and pre-edit content by tool_use id.
export function collectEditDetailsByToolUseId(
  records: TranscriptRecord[],
): Map<string, EditDetail> {
  const nameById = buildToolUseNamesById(records);
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
    const structuredPatch = result?.structuredPatch;
    if (structuredPatch) {
      detailById.set(block.tool_use_id.toString(), { hunks: structuredPatch, originalFile: result?.originalFile });
    }
  }
}
