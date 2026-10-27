// task 193: turn-end boundary search used by bounded reconstruction.

import type { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";

export type TurnBoundary = { index: number; instant: Date };

// Only main-chain genuine prompts end a turn; sidechain prompts do not.
function isTurnBoundary(record: TranscriptRecord): boolean {
  if (record.isSidechain === true) {
    return false;
  }
  return isGenuineUserPrompt(record);
}

// First turn-boundary prompt strictly after `after` in the owning session; undefined at stream end.
export function findTurnEndBoundary(
  records: TranscriptRecord[],
  after: Date,
  ownerSession: Uuid | undefined,
): TurnBoundary | undefined {
  const afterMs = after.getTime();
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const isBoundary = isTurnBoundary(record);
    if (!isBoundary) {
      continue;
    }
    const recordSession = record.sessionId?.toString();
    const isOtherSession = ownerSession !== undefined && recordSession !== ownerSession.toString();
    if (isOtherSession) {
      continue;
    }
    if (!(record.timestamp instanceof Date)) {
      continue;
    }
    const recordMs = record.timestamp.getTime();
    if (recordMs > afterMs) {
      return { index, instant: record.timestamp };
    }
  }
  return undefined;
}

// Stamped records survive if strictly before the boundary instant; unstamped survive by index.
export function isRecordWithinBound(
  record: TranscriptRecord,
  index: number,
  boundary: TurnBoundary,
): boolean {
  if (record.timestamp instanceof Date) {
    const recordMs = record.timestamp.getTime();
    const boundaryMs = boundary.instant.getTime();
    return recordMs < boundaryMs;
  }
  return index < boundary.index;
}
