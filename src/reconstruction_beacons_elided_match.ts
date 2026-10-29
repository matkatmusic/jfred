// Elided (s28) beacon helpers: detect windowed snippets and match backups to them.

import { splitLines } from "./reconstruction_replay_edit.ts";
import type { BeaconSnippet } from "./reconstruction_user_edit.ts";
import type { WriteEvent } from "./reconstruction_events.ts";

// Detects windowed snippets (s28); pure tail-truncation is left to s27 truncated completion.
export function isBeaconElided(snippet: BeaconSnippet): boolean {
  const first = snippet.lines[0];
  if (first === undefined) {
    return false;
  }
  const startsMidFile = first.lineNo > 1;
  const isWindowed = snippet.hasEllipsis || startsMidFile;
  if (isWindowed) {
    return true;
  }
  for (let index = 1; index < snippet.lines.length; index += 1) {
    const hasGap = snippet.lines[index]!.lineNo !== snippet.lines[index - 1]!.lineNo + 1;
    if (hasGap) {
      return true;
    }
  }
  return false;
}

// Forward-validates backup by matching every visible beacon line at its line number; rejects mismatches.
export function isBackupMatchingBeacon(snippet: BeaconSnippet, backupContent: string): boolean {
  const lines = splitLines(backupContent);
  if (lines.length <= snippet.lines.length) {
    return false;
  }
  for (const { lineNo, text } of snippet.lines) {
    const isPastEnd = lineNo - 1 >= lines.length;
    const isDifferent = lines[lineNo - 1] !== text;
    const isMismatch = isPastEnd || isDifferent;
    if (isMismatch) {
      return false;
    }
  }
  return true;
}

// Rejects backups newer than the next lineage event to exclude later edits' effects.
export function isBackupWithinBound(candidate: WriteEvent, notAfter: Date | undefined): boolean {
  if (notAfter === undefined) {
    return true;
  }
  return candidate.timestamp.getTime() <= notAfter.getTime();
}

// Midpoint between last backup without and first backup with the content; brackets the real edit time.
export function computeBracketMidpointTime(seed: WriteEvent, backups: WriteEvent[]): Date {
  let firstWith = seed;
  for (const backup of backups) {
    if (backup.content === seed.content) {
      firstWith = backup;
      break;
    }
  }
  let lastWithout: WriteEvent | undefined;
  for (const backup of backups) {
    const isBeforeFirstWith = backup.timestamp.getTime() < firstWith.timestamp.getTime();
    const lacksContent = backup.content !== seed.content;
    const isCandidate = isBeforeFirstWith && lacksContent;
    if (isCandidate) {
      lastWithout = backup;
    }
  }
  if (lastWithout === undefined) {
    return seed.timestamp;
  }
  return new Date((lastWithout.timestamp.getTime() + firstWith.timestamp.getTime()) / 2);
}
