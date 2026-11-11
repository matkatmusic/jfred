// Pairs each Write/Edit call with the user line holding its result, so the replay applies the edit at the call line.

import { getContentBlocks, type ContentBlock } from "../src/structures/content-blocks.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import { getFileHistorySnapshot } from "../src/structures/file-history.ts";
import type { JSONLLine } from "./engineV3.ts";

export function isWriteOrEditName(name: string): boolean {
  if (name === ToolName.Write) {
    return true;
  }
  return name === ToolName.Edit;
}

// A line with no timestamp (an api-request-blob) has blocks that getContentBlocks cannot read, and holds no tool call.
export function getBlocksOfTimedLine(line: JSONLLine): ContentBlock[] {
  if (line.timestamp instanceof Date) {
    return getContentBlocks(line);
  }
  return [];
}

// The tool_use id texts of the Write/Edit blocks in the line, in block order.
export function listWriteEditCallIds(line: JSONLLine): string[] {
  const callIds: string[] = [];
  for (const block of getBlocksOfTimedLine(line)) {
    if (block.type === BlockType.tool_use) {
      if (isWriteOrEditName(block.name)) {
        callIds.push(block.id.toString());
      }
    }
  }
  return callIds;
}

function listToolResultIds(line: JSONLLine): string[] {
  const resultIds: string[] = [];
  for (const block of getBlocksOfTimedLine(line)) {
    if (block.type === BlockType.tool_result) {
      resultIds.push(block.tool_use_id.toString());
    }
  }
  return resultIds;
}

// True when the line holds the result of a Write/Edit call that the call line already applied.
export function isAppliedWriteEditResult(line: JSONLLine, resultLines: Map<string, JSONLLine>): boolean {
  for (const resultId of listToolResultIds(line)) {
    if (resultLines.has(resultId)) {
      return true;
    }
  }
  return false;
}

// Keyed by tool_use id text: the messageId of the turn-start snapshot (not an update) that the result's parent chain reaches first.
export function collectResultTurnSnapshotIds(lines: JSONLLine[], resultLines: Map<string, JSONLLine>): Map<string, string> {
  const turnStartIds = new Set<string>();
  const parentIdByLineId = new Map<string, string>();
  for (const line of lines) {
    const snapshotMessage = getFileHistorySnapshot(line);
    if (snapshotMessage !== undefined) {
      if (snapshotMessage.isSnapshotUpdate === false) {
        turnStartIds.add(snapshotMessage.messageId.toString());
      }
    }
    if (line.uuid !== undefined) {
      if (line.parentUuid !== undefined && line.parentUuid !== null) {
        parentIdByLineId.set(line.uuid.toString(), line.parentUuid.toString());
      }
    }
  }
  const turnSnapshotIdByCallId = new Map<string, string>();
  for (const [callId, resultLine] of resultLines) {
    let ancestorId = resultLine.parentUuid?.toString();
    while (ancestorId !== undefined) {
      if (turnStartIds.has(ancestorId)) {
        turnSnapshotIdByCallId.set(callId, ancestorId);
        break;
      }
      ancestorId = parentIdByLineId.get(ancestorId);
    }
  }
  return turnSnapshotIdByCallId;
}

// Keyed by tool_use id text; a call with no result line, or a result with no call line, is left out.
export function collectWriteEditResultLines(lines: JSONLLine[]): Map<string, JSONLLine> {
  const callIds = new Set<string>();
  for (const line of lines) {
    for (const callId of listWriteEditCallIds(line)) {
      callIds.add(callId);
    }
  }
  const resultLines = new Map<string, JSONLLine>();
  for (const line of lines) {
    for (const resultId of listToolResultIds(line)) {
      if (callIds.has(resultId)) {
        resultLines.set(resultId, line);
      }
    }
  }
  return resultLines;
}
