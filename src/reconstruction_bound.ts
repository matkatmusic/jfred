// task 193: bounded reconstruction via input truncation at the nth revision's turn end.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { findTurnEndBoundary, isRecordWithinBound } from "./reconstruction_bound_turn.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";

// Cut stream, total revision count, and wall-clock boundary instant (undefined if final turn).
export type RevisionBound = {
  records: TranscriptRecord[];
  totalRevisions: number;
  boundInstant: Date | undefined;
};

// task 194: webapp bounded-mode request — truncate at file's ordinal-th revision turn end.
export type RevisionBoundRequest = {
  file: Path;
  ordinal: number;
};

// The path fields an event carries: rename/copy name from→to, every other kind a target.
export function listEventPaths(event: FileEvent): Path[] {
  if (event.kind === EventKind.rename) {
    return [event.from, event.to];
  }
  if (event.kind === EventKind.copy) {
    return [event.from, event.to];
  }
  return [event.target];
}

// Filter events touching target by exact-path equality in timestamp order.
function selectEventsTouchingPath(events: FileEvent[], target: Path): FileEvent[] {
  const targetKey = target.toString();
  const touching: FileEvent[] = [];
  for (const event of events) {
    const pathKeys: string[] = [];
    for (const eventPath of listEventPaths(event)) {
      pathKeys.push(eventPath.toString());
    }
    const isTouching = pathKeys.includes(targetKey);
    if (isTouching) {
      touching.push(event);
    }
  }
  return touching;
}

// True when one of the record's tool_use blocks carries this change id.
function isRecordCarryingToolUse(record: TranscriptRecord, changeKey: string): boolean {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_use) {
      const blockKey = block.id.toString();
      if (blockKey === changeKey) {
        return true;
      }
    }
  }
  return false;
}

// Find the session that produced this event via its changeId (uuid or tool_use id).
function findEventSessionId(records: TranscriptRecord[], event: FileEvent): Uuid | undefined {
  const changeKey = event.changeId.toString();
  for (const record of records) {
    const isChangeUuid = record.uuid?.toString() === changeKey;
    const isChangeToolUse = isRecordCarryingToolUse(record, changeKey);
    const isOwner = isChangeUuid || isChangeToolUse;
    if (isOwner) {
      return record.sessionId;
    }
  }
  return undefined;
}

// Truncate records at the turn containing the target's nth revision; throws on missing/out-of-range.
export function trimRecordsAtRevisionTurnEnd(
  records: TranscriptRecord[],
  target: Path,
  ordinal: number,
): RevisionBound {
  const revisions = selectEventsTouchingPath(extractFileEvents(records), target);
  if (revisions.length === 0) {
    throw new Error(`--until-revision: no revisions of ${target} found`);
  }
  const isOutOfRange = ordinal < 1 || ordinal > revisions.length;
  if (isOutOfRange) {
    throw new Error(`--until-revision: revision ${ordinal} of ${target} out of range 1..${revisions.length}`);
  }
  const chosen = revisions[ordinal - 1]!;
  const ownerSession = findEventSessionId(records, chosen);
  const boundary = findTurnEndBoundary(records, chosen.timestamp, ownerSession);
  if (boundary === undefined) {
    return { records, totalRevisions: revisions.length, boundInstant: undefined };
  }
  const kept: TranscriptRecord[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const isKept = isRecordWithinBound(record, index, boundary);
    if (isKept) {
      kept.push(record);
    }
  }
  return { records: kept, totalRevisions: revisions.length, boundInstant: boundary.instant };
}

// No-op without --until-revision; otherwise truncate and report summary on stderr.
export function applyRevisionBound(records: TranscriptRecord[], options: CliOptions): TranscriptRecord[] {
  if (options.untilRevision === undefined) {
    return records;
  }
  const bound = trimRecordsAtRevisionTurnEnd(records, options.untilRevision, options.untilNth);
  const boundLabel = bound.boundInstant?.toISOString() ?? "end of transcript";
  process.stderr.write(
    `until-revision: ${options.untilRevision} revision ${options.untilNth}/${bound.totalRevisions}; bounded at ${boundLabel}; records ${bound.records.length}/${records.length}\n`,
  );
  return bound.records;
}
