// §a session-root path lookups: which records, events and rel-paths belong to which root.

import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileEvent } from "./reconstruction_events.ts";

export type PrimaryPath = { absolute: string; root: string };

// Extract sessionId from envelope; lives here to keep module imports one-way.
export function getSessionId(record: TranscriptRecord): Uuid | undefined {
  return (record as { sessionId?: Uuid }).sessionId;
}

// Every path one event references (rename/copy carry from/to instead of a target).
function listEventPaths(event: FileEvent): Path[] {
  if ("target" in event) {
    return [event.target];
  }
  return [event.from, event.to];
}

// True when the record's session resolved to the given root.
export function isRecordInRoot(record: TranscriptRecord, sessionRoots: Map<string, Path>, root: string): boolean {
  const sessionId = getSessionId(record);
  if (sessionId === undefined) {
    return false;
  }
  const recordRoot = sessionRoots.get(sessionId.toString());
  return recordRoot?.toString() === root;
}

// The records whose session resolved to the given root.
export function filterRecordsByRoot(
  records: TranscriptRecord[],
  sessionRoots: Map<string, Path>,
  root: string,
): TranscriptRecord[] {
  const matching: TranscriptRecord[] = [];
  for (const record of records) {
    const isInRoot = isRecordInRoot(record, sessionRoots, root);
    if (isInRoot) {
      matching.push(record);
    }
  }
  return matching;
}

// relPath -> absolutePath (first seen) for every event path under the given root.
export function collectRelativePathMap(records: TranscriptRecord[], root: string): Map<string, string> {
  const relativeToAbsolute = new Map<string, string>();
  const eventPaths: Path[] = [];
  for (const event of extractFileEvents(records)) {
    eventPaths.push(...listEventPaths(event));
  }
  for (const eventPath of eventPaths) {
    const absolute = eventPath.toString();
    const isUnderRoot = absolute.startsWith(root + "/");
    if (!isUnderRoot) {
      continue;
    }
    const relative = absolute.slice(root.length + 1);
    const isKnown = relativeToAbsolute.has(relative);
    if (!isKnown) {
      relativeToAbsolute.set(relative, absolute);
    }
  }
  return relativeToAbsolute;
}

// The first event in the (time-ordered) records referencing the absolute path: the joining source's evidence.
export function findFirstEventForPath(records: TranscriptRecord[], absolutePath: string): FileEvent | undefined {
  for (const event of extractFileEvents(records)) {
    for (const eventPath of listEventPaths(event)) {
      const eventPathText = eventPath.toString();
      if (eventPathText === absolutePath) {
        return event;
      }
    }
  }
  return undefined;
}

// Session roots in first-appearance order; earliest root owns each rel-path.
export function computeRootOrder(records: TranscriptRecord[], sessionRoots: Map<string, Path>): string[] {
  const rootOrder: string[] = [];
  for (const record of records) {
    const sessionId = getSessionId(record);
    if (sessionId === undefined) {
      continue;
    }
    const root = sessionRoots.get(sessionId.toString());
    if (root === undefined) {
      continue;
    }
    const rootText = root.toString();
    const isKnown = rootOrder.includes(rootText);
    if (!isKnown) {
      rootOrder.push(rootText);
    }
  }
  return rootOrder;
}

// Merge one root's rel-path map into the primary map, earlier owners keeping their claim.
function addMissingPrimaryEntries(
  primaryPaths: Map<string, PrimaryPath>,
  relativeToAbsolute: Map<string, string>,
  root: string,
): void {
  for (const [relative, absolute] of relativeToAbsolute) {
    const isClaimed = primaryPaths.has(relative);
    if (!isClaimed) {
      primaryPaths.set(relative, { absolute, root });
    }
  }
}

// rel-path -> primary absolute path across every root earlier than laterIndex, earliest owner winning.
export function collectPrimaryPaths(
  records: TranscriptRecord[],
  sessionRoots: Map<string, Path>,
  rootOrder: string[],
  laterIndex: number,
): Map<string, PrimaryPath> {
  const primaryPaths = new Map<string, PrimaryPath>();
  for (const earlierRoot of rootOrder.slice(0, laterIndex)) {
    const earlierMap = collectRelativePathMap(filterRecordsByRoot(records, sessionRoots, earlierRoot), earlierRoot);
    addMissingPrimaryEntries(primaryPaths, earlierMap, earlierRoot);
  }
  return primaryPaths;
}
