// Candidate seed Writes for edits whose base is stale or outside the hunk window.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { splitLines, getPreEditLines } from "./reconstruction_replay_edit.ts";
import { backupSeedWriteFor, backupAfterWriteFor } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { EditEvent, FileEvent, WriteEvent } from "./reconstruction_events.ts";
import { findLastPriorTime, getReconstructedBaseText, isFirstHunkMatchingBase, isLinePrefix } from "./reconstruction_reseed_base.ts";

// Synthetic prefix keeps `originalFile` reseed Writes out of the graphs.
export const ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX = "originalFile:";

function getOriginalFileSeed(event: EditEvent): WriteEvent | undefined {
  // `== null` catches both absent and null; a null-content seed crashes splitLines.
  if (event.originalFile == null) {
    return undefined;
  }
  return {
    kind: EventKind.write,
    changeId: new Uuid(`${ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX}${event.changeId}`),
    target: event.target,
    content: event.originalFile,
    timestamp: event.timestamp,
  };
}

// s34: a manual change outside the hunk window is detected by content, not hunk context.
export function findOutOfWindowEditSeed(
  records: TranscriptRecord[],
  event: EditEvent,
  priorEvents: FileEvent[],
  reader: BackupReader,
): WriteEvent | undefined {
  const base = getReconstructedBaseText(priorEvents);
  const backup = backupSeedWriteFor(records, event.target, event.timestamp, reader);
  const original = getOriginalFileSeed(event);
  const lastPrior = findLastPriorTime(event.target, priorEvents);
  // A candidate must extend the base by a trailing append and splice cleanly (s70 rejected).
  for (const seed of [backup, original]) {
    if (seed === undefined) {
      continue;
    }
    const isNotAfterLastPrior = lastPrior !== undefined && seed.timestamp.getTime() <= lastPrior.getTime();
    if (isNotAfterLastPrior) {
      continue;
    }
    const seedLines = splitLines(seed.content);
    const extendsBase = seedLines.length > base.length && isLinePrefix(base, seedLines);
    const isCleanAppend = extendsBase && isFirstHunkMatchingBase(event, seedLines);
    if (isCleanAppend) {
      return seed;
    }
  }
  return undefined;
}

// Recovers s28's renamed-no-preview base; the reversed base must splice cleanly or we fall through.
export function findReversedEditBaseSeed(
  records: TranscriptRecord[],
  event: EditEvent,
  reader: BackupReader,
): WriteEvent | undefined {
  const after = backupAfterWriteFor(records, event.target, event.timestamp, reader);
  if (after === undefined) {
    return undefined;
  }
  const reversed = getPreEditLines(splitLines(after.content), event);
  if (reversed === undefined) {
    return undefined;
  }
  const isBaseMatching = isFirstHunkMatchingBase(event, reversed);
  if (!isBaseMatching) {
    return undefined;
  }
  // Reverse only when an at-or-before backup differs from the reversed base (s28 signature).
  const reversedContent = reversed.join("\n") + "\n";
  const atOrBefore = backupSeedWriteFor(records, event.target, event.timestamp, reader);
  if (atOrBefore === undefined) {
    return undefined;
  }
  if (atOrBefore.content === reversedContent) {
    return undefined;
  }
  return { ...after, content: reversedContent };
}
