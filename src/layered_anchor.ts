// Layer-1 anchor semantics: first full-content beacon per timeline (spec S2/Q14).

import { getRecordSource } from "./parse/loadTranscript.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import {
  getToolResultForUserRecord,
  buildToolUseNamesById,
  findToolNameForRecord,
} from "./structures/tool-results.ts";
import type { ReadResult } from "./structures/tool-result-shapes.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { LayeredNodeKind } from "./structures/vocabulary_views.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type {
  BeaconNode,
  EndStateNode,
  JsonlRef,
  Timeline,
  TimelineNode,
} from "./layered_types.ts";

// Returns the timeline's first beacon node — its anchor (Q14).
export function selectAnchorNode(timeline: Timeline): BeaconNode | undefined {
  for (const node of timeline.nodes) {
    if (node.kind === LayeredNodeKind.beacon) {
      return node;
    }
  }
  return undefined;
}

// Single source of "which kinds carry bytes" for gap pairing.
export function isNodeCarryingBytes(node: TimelineNode): node is BeaconNode | EndStateNode {
  if (node.kind === LayeredNodeKind.beacon) {
    return true;
  }
  return node.kind === LayeredNodeKind.endState;
}

// Returns verified bytes; byteless kinds throw (spec S2).
export function getRequiredNodeContent(node: TimelineNode): string {
  const carriesBytes = isNodeCarryingBytes(node);
  if (carriesBytes) {
    return node.content;
  }
  throw new Error(`${node.kind} node refuses byte operations (display/placement only)`);
}

// Whether the echo covers the WHOLE file: from line 1 through every line the file holds.
function isReadEchoComplete(result: ReadResult): boolean {
  if (result.file.startLine === 1) {
    return result.file.numLines === result.file.totalLines;
  }
  return false;
}

// Complete echo becomes beacon; partial window becomes pre-anchor stub.
function buildReadEchoNode(result: ReadResult, instant: Date, evidence: JsonlRef): TimelineNode {
  const isComplete = isReadEchoComplete(result);
  if (isComplete) {
    return { kind: LayeredNodeKind.beacon, instant, content: result.file.content, evidence };
  }
  return { kind: LayeredNodeKind.preAnchorStub, instant, evidence };
}

// One file's Read-echo node placement: which timeline it lands on plus the node itself.
export type ReadEchoPlacement = { target: Path; node: TimelineNode; changeId: Uuid; instant: Date };

function findToolResultId(record: TranscriptRecord): Uuid {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_result) {
      return block.tool_use_id;
    }
  }
  throw new Error("Read result record has no tool_result block");
}

// Filter by tool name first to avoid fog-of-war throws from getToolResultForUserRecord.
function buildReadEchoPlacement(
  record: TranscriptRecord,
  nameById: Map<string, string>,
  sessionFile: Path,
): ReadEchoPlacement | undefined {
  const toolName = findToolNameForRecord(record, nameById);
  if (toolName !== ToolName.Read) {
    return undefined;
  }
  const resolved = getToolResultForUserRecord(record, nameById);
  if (resolved === undefined) {
    return undefined;
  }
  if (resolved.toolName !== ToolName.Read) {
    return undefined;
  }
  const source = getRecordSource(record);
  if (source === undefined) {
    return undefined;
  }
  const instant = record.timestamp;
  if (!(instant instanceof Date)) {
    return undefined;
  }
  const evidence: JsonlRef = { sessionFile, line: source.lineNumber };
  return {
    target: resolved.result.file.filePath,
    node: buildReadEchoNode(resolved.result, instant, evidence),
    changeId: findToolResultId(record),
    instant,
  };
}

// Collect every Read echo across one session's records as layer-1 node placements.
export function collectReadEchoNodes(records: TranscriptRecord[], sessionFile: Path): ReadEchoPlacement[] {
  const nameById = buildToolUseNamesById(records);
  const placements: ReadEchoPlacement[] = [];
  for (const record of records) {
    const placement = buildReadEchoPlacement(record, nameById, sessionFile);
    if (placement !== undefined) {
      placements.push(placement);
    }
  }
  return placements;
}

