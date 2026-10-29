// Complete elided (s28) beacons via sidecar backups.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { getBackupWrites } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { getBeaconSnippet } from "./reconstruction_user_edit.ts";
import type { FileEvent, UserEditEvent, WriteEvent } from "./reconstruction_events.ts";
import {
  computeBracketMidpointTime,
  isBackupMatchingBeacon,
  isBackupWithinBound,
  isBeaconElided,
} from "./reconstruction_beacons_elided_match.ts";

// Only retimed when a real edit sits between the midpoint and the beacon.
function isEditBetween(lineage: FileEvent[], beacon: UserEditEvent, midpoint: Date): boolean {
  for (const event of lineage) {
    const isOther = event !== beacon;
    const isAfterMidpoint = event.timestamp.getTime() > midpoint.getTime();
    const isBeforeBeacon = event.timestamp.getTime() < beacon.timestamp.getTime();
    const isBetween = isOther && isAfterMidpoint && isBeforeBeacon;
    if (isBetween) {
      return true;
    }
  }
  return false;
}

// Latest in-bound backup matching an elided beacon's visible lines, retimed to the bracket midpoint.
function findElidedBeaconSeed(
  records: TranscriptRecord[],
  beacon: UserEditEvent,
  reader: BackupReader,
  notAfter: Date | undefined,
  lineage: FileEvent[],
): WriteEvent | undefined {
  const snippet = getBeaconSnippet(records, beacon.changeId);
  if (snippet === undefined) {
    return undefined;
  }
  const snippetIsElided = isBeaconElided(snippet);
  if (!snippetIsElided) {
    return undefined;
  }
  const backups = getBackupWrites(records, beacon.target, reader);
  let match: WriteEvent | undefined;
  for (const candidate of backups) {
    const isInBound = isBackupWithinBound(candidate, notAfter);
    if (!isInBound) {
      continue;
    }
    const matchesVisibleLines = isBackupMatchingBeacon(snippet, candidate.content);
    if (matchesVisibleLines) {
      match = candidate; // time-ascending; keep the latest in-bound version consistent with the window
    }
  }
  if (match === undefined) {
    return undefined;
  }
  // Only retime terminal beacons to the bracket midpoint; skip if a real edit sits between.
  const midpoint = computeBracketMidpointTime(match, backups);
  const crossesEdit = isEditBetween(lineage, beacon, midpoint);
  const midpointIsNotBeforeBeacon = midpoint.getTime() >= beacon.timestamp.getTime();
  const isBound = notAfter !== undefined;
  const keepsBackupTime = isBound || midpointIsNotBeforeBeacon || crossesEdit;
  if (keepsBackupTime) {
    return match;
  }
  return { ...match, timestamp: midpoint };
}

// Record that an elided-beacon completion fired, tagging the beacon (its changeId) and the backup time used.
function logElidedSeed(beacon: UserEditEvent, seed: WriteEvent): void {
  noteStage({
    stage: "completeElidedBeacons",
    target: beacon.target,
    changeId: beacon.changeId,
    detail: "spliced a synthetic Write completing an elided (windowed) user-edit beacon",
    when: seed.timestamp,
  });
}

// Splice a backup Write after each elided beacon so later Edits apply to complete content.
export function insertElidedBeaconSeeds(
  records: TranscriptRecord[],
  events: FileEvent[],
  reader: BackupReader,
): FileEvent[] {
  const result: FileEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind !== EventKind.userEdit) {
      result.push(event);
      continue;
    }
    const seed = findElidedBeaconSeed(records, event, reader, events[index + 1]?.timestamp, events);
    if (seed === undefined) {
      result.push(event);
      continue;
    }
    // Retime a stale-echo beacon to the seed's instant so windowed content does not mask it.
    const seedIsEarlier = seed.timestamp.getTime() < event.timestamp.getTime();
    const beacon = seedIsEarlier ? { ...event, timestamp: seed.timestamp } : event;
    logElidedSeed(event, seed);
    result.push(beacon);
    result.push(seed);
  }
  return result;
}
