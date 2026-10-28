// Task 357 step 4: reads the engine's pre-state check to tell a conversation-only rewind from a code rewind.

import { WireRewindKind, type WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { EditEvent, FileEvent, FileRevision } from "./reconstruction_events.ts";
import { isEditEvidenceMatchingState } from "./reconstruction_multi_source_gate.ts";
import { getLinesText } from "./reconstruction_revisions.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getToolResultForUserRecord, buildToolUseNamesById } from "./structures/tool-results.ts";
import { BlockType, EventKind, ToolName } from "./structures/vocabulary.ts";

export type WireBranchRow = WireBranchesViewOf<Date, Path, Uuid>["pairs"][number]["branches"][number];
type LaneKind = Pick<WireBranchRow, "rewindKind" | "rejoinAt" | "keptToEnd">;

// tool_use id to the Write result's originalFile; other tools carry no pre-state.
export function collectWriteOriginalFiles(records: TranscriptRecord[]): Map<string, string | null> {
  const nameById = buildToolUseNamesById(records);
  const originalFileById = new Map<string, string | null>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      const isNotToolResult = block.type !== BlockType.tool_result;
      if (isNotToolResult) {
        continue;
      }
      const toolName = nameById.get(block.tool_use_id.toString());
      const isNotWriteTool = toolName !== ToolName.Write;
      if (isNotWriteTool) {
        continue;
      }
      const resolved = getToolResultForUserRecord(record, nameById);
      if (resolved?.toolName === ToolName.Write) {
        originalFileById.set(block.tool_use_id.toString(), resolved.result.originalFile);
      }
    }
  }
  return originalFileById;
}

export interface PreStateEvidence {
  eventById: Map<string, FileEvent>;
  writeOriginalFileById: Map<string, string | null>;
}

// Do the bytes the lane left on disk flow into `next`?
function isLaneBytesKeptByNextRevision(next: FileRevision, laneLastLines: string[], evidence: PreStateEvidence): boolean {
  const event = evidence.eventById.get(next.changeId.toString());
  const laneLastText = laneLastLines.join("\n");
  if (event?.kind === EventKind.edit) {
    return isEditEvidenceMatchingState(event, laneLastText);
  }
  if (event?.kind === EventKind.write) {
    const originalFile = evidence.writeOriginalFileById.get(next.changeId.toString());
    const asEdit: EditEvent = { kind: EventKind.edit, changeId: event.changeId, target: event.target, hunks: [], originalFile, timestamp: event.timestamp };
    return typeof originalFile === "string" && originalFile !== "" && isEditEvidenceMatchingState(asEdit, laneLastText);
  }
  if (event?.kind === EventKind.overwrite) {
    return false;
  }
  const nextLines = new Set(getLinesText(next));
  for (const line of laneLastLines) {
    const isBlankLine = line.trim() === "";
    if (isBlankLine) {
      continue;
    }
    const isKept = nextLines.has(line);
    if (!isKept) {
      return false;
    }
  }
  return true;
}

export function computeLaneKind(revisions: FileRevision[], laneLastIndex: number, allLaneIds: Set<string>, evidence: PreStateEvidence): LaneKind {
  const laneLastLines = getLinesText(revisions[laneLastIndex]!);
  let next: FileRevision | undefined;
  for (const revision of revisions.slice(laneLastIndex + 1)) {
    const isLaneRevision = allLaneIds.has(revision.changeId.toString());
    if (!isLaneRevision) {
      next = revision;
      break;
    }
  }
  if (next === undefined) {
    const isDiskFinalText = getLinesText(revisions.at(-1)!).join("\n") === laneLastLines.join("\n");
    return isDiskFinalText ? { rewindKind: WireRewindKind.conversation, keptToEnd: true } : { rewindKind: WireRewindKind.code };
  }
  return isLaneBytesKeptByNextRevision(next, laneLastLines, evidence)
    ? { rewindKind: WireRewindKind.conversation, rejoinAt: next.timestamp }
    : { rewindKind: WireRewindKind.code };
}
