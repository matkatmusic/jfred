// Task 357 step 4: reads the engine's pre-state check to tell a conversation-only rewind from a code rewind.

import { WireRewindKind, type WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { EditEvent, FileEvent, FileRevision } from "./reconstruction_events.ts";
import { editEvidenceAgreesWithState } from "./reconstruction_multi_source_gate.ts";
import { linesTextOf } from "./reconstruction_revisions.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getToolResultForUserRecord, buildToolUseNamesById } from "./structures/tool-results.ts";
import { BlockType, EventKind, ToolName } from "./structures/vocabulary.ts";

export type WireBranchRow = WireBranchesViewOf<Date, Path, Uuid>["pairs"][number]["branches"][number];
type LaneKind = Pick<WireBranchRow, "rewindKind" | "rejoinAt" | "keptToEnd">;

// tool_use id to the Write result's originalFile; other tools carry no pre-state.
export function indexWriteOriginalFiles(records: TranscriptRecord[]): Map<string, string | null> {
  const nameById = buildToolUseNamesById(records);
  const originalFileById = new Map<string, string | null>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_result || nameById.get(block.tool_use_id.toString()) !== ToolName.Write) {
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
function doesNextRevisionKeepLaneBytes(next: FileRevision, laneLastLines: string[], evidence: PreStateEvidence): boolean {
  const event = evidence.eventById.get(next.changeId.toString());
  const laneLastText = laneLastLines.join("\n");
  if (event?.kind === EventKind.edit) {
    return editEvidenceAgreesWithState(event, laneLastText);
  }
  if (event?.kind === EventKind.write) {
    const originalFile = evidence.writeOriginalFileById.get(next.changeId.toString());
    const asEdit: EditEvent = { kind: EventKind.edit, changeId: event.changeId, target: event.target, hunks: [], originalFile, timestamp: event.timestamp };
    return typeof originalFile === "string" && originalFile !== "" && editEvidenceAgreesWithState(asEdit, laneLastText);
  }
  if (event?.kind === EventKind.overwrite) {
    return false;
  }
  const nextLines = new Set(linesTextOf(next));
  return laneLastLines.filter((line) => line.trim() !== "").every((line) => nextLines.has(line));
}

export function classifyLane(revisions: FileRevision[], laneLastIndex: number, allLaneIds: Set<string>, evidence: PreStateEvidence): LaneKind {
  const laneLastLines = linesTextOf(revisions[laneLastIndex]!);
  const next = revisions.slice(laneLastIndex + 1).find((revision) => !allLaneIds.has(revision.changeId.toString()));
  if (next === undefined) {
    const isDiskFinalText = linesTextOf(revisions.at(-1)!).join("\n") === laneLastLines.join("\n");
    return isDiskFinalText ? { rewindKind: WireRewindKind.conversation, keptToEnd: true } : { rewindKind: WireRewindKind.code };
  }
  return doesNextRevisionKeepLaneBytes(next, laneLastLines, evidence)
    ? { rewindKind: WireRewindKind.conversation, rejoinAt: next.timestamp }
    : { rewindKind: WireRewindKind.code };
}
