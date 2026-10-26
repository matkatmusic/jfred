// Extraction: transcript records to ordered file events.

import { getContentBlocks } from "./structures/content-blocks.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";
import { readWriteInput } from "./structures/tool-result-shapes.ts";
import { BlockType, EventKind, ToolName, Verdict } from "./structures/vocabulary.ts";
import { getRecordVerdict } from "./reconstruction_parse_lines.ts";
import { Path } from "./structures/domain.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_events.ts";
import {
  collectEditDetailsByToolUseId,
  createEditEvent,
  type EditDetail,
} from "./reconstruction_extract_edit_details.ts";
import { bashEventsFrom } from "./reconstruction_bash_events.ts";
import { extractScriptRenameEvents } from "./reconstruction_script_renames.ts";
import { userEditEventFrom } from "./reconstruction_user_edit.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";

// Turn a Write tool_use into a write event; newer transcripts name the input keys path/file_text.
function writeEventFrom(block: ToolUseBlock, timestamp: Date): WriteEvent {
  const { filePath, content } = readWriteInput(block);
  return {
    kind: EventKind.write,
    changeId: block.id,
    target: filePath,
    content,
    timestamp,
  };
}

// Map a tool_use block to file events based on tool type.
function convertToFileEvents(
  block: ToolUseBlock,
  timestamp: Date,
  detailById: Map<string, EditDetail>,
  cwd: Path | undefined,
  erroredIds: Set<string>,
): FileEvent[] {
  if (block.name === ToolName.Write) {
    if (erroredIds.has(block.id.toString())) {
      return [];
    }
    const e = writeEventFrom(block, timestamp);
    return e ? [e] : [];
  }
  if (block.name === ToolName.Bash) {
    return bashEventsFrom(block, timestamp, cwd);
  }
  if (block.name === ToolName.Edit) {
    const e = createEditEvent(block, timestamp, detailById);
    return e ? [e] : [];
  }
  return [];
}

function collectEventsFromRecord(
  record: TranscriptRecord,
  events: FileEvent[],
  detailById: Map<string, EditDetail>,
  erroredIds: Set<string>,
): void {
  // Skip records the classifier marks as `ignore`.
  if (getRecordVerdict(record) === Verdict.ignore) {
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
    events.push(...convertToFileEvents(block, timestamp, detailById, cwd, erroredIds));
  }
  const userEdit = userEditEventFrom(record);
  if (userEdit) {
    events.push(userEdit);
  }
}

// Extract all file events from the transcript, memoized per corpus identity.
export function extractFileEvents(records: TranscriptRecord[]): FileEvent[] {
  const state = getCorpusState(records);
  if (state.fileEvents !== undefined) {
    return state.fileEvents;
  }
  const detailById = collectEditDetailsByToolUseId(records);
  const erroredIds = collectErroredToolUseIds(records);
  const events: FileEvent[] = [];
  for (const record of records) {
    collectEventsFromRecord(record, events, detailById, erroredIds);
  }
  events.push(...extractScriptRenameEvents(records));
  state.fileEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return state.fileEvents;
}
