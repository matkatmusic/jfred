// Base-text checks that decide whether an edit's base is stale.

import type { Path } from "./structures/domain.ts";
import { collectRevisions } from "./reconstruction_replay.ts";
import { getLastLines } from "./reconstruction_replay_edit.ts";
import type { EditEvent, FileEvent } from "./reconstruction_events.ts";

export function getReconstructedBaseText(priorEvents: FileEvent[]): string[] {
  const entries = getLastLines(collectRevisions(priorEvents));
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(entry.values[entry.values.length - 1]!.line);
  }
  return lines;
}

// A mismatch means the hunk lands on wrong lines, or the candidate backup is poison.
export function isFirstHunkMatchingBase(event: EditEvent, base: string[]): boolean {
  const firstHunk = event.hunks[0];
  if (firstHunk === undefined) {
    return true;
  }
  let index = firstHunk.oldStart - 1;
  for (const line of firstHunk.lines) {
    const isAddedLine = line.startsWith("+");
    if (isAddedLine) {
      continue;
    }
    const isPastBase = index >= base.length;
    const isDifferentLine = base[index] !== line.slice(1);
    const isMismatch = isPastBase || isDifferentLine;
    if (isMismatch) {
      return false;
    }
    index += 1;
  }
  return true;
}

export function isEditBaseStale(event: EditEvent, priorEvents: FileEvent[]): boolean {
  const base = getReconstructedBaseText(priorEvents);
  const isMatching = isFirstHunkMatchingBase(event, base);
  return !isMatching;
}

export function isLinePrefix(prefix: string[], lines: string[]): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== lines[index]) {
      return false;
    }
  }
  return true;
}

export function findLastPriorTime(target: Path, priorEvents: FileEvent[]): Date | undefined {
  const targetText = target.toString();
  let latest: Date | undefined;
  for (const event of priorEvents) {
    if (!("target" in event)) {
      continue;
    }
    const eventTargetText = event.target.toString();
    if (eventTargetText !== targetText) {
      continue;
    }
    const eventTime = event.timestamp.getTime();
    const isLater = latest === undefined || eventTime > latest.getTime();
    if (isLater) {
      latest = event.timestamp;
    }
  }
  return latest;
}
