// Complete truncated (s27) terminal beacons via sidecar backups.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { latestBackupWriteFor } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import type { FileEvent, UserEditEvent } from "./reconstruction_events.ts";

// Line-count gate excludes trailing-newline-only diffs; startsWith rejects poison backups.
export function isBeaconTruncated(beacon: UserEditEvent, backupContent: string): boolean {
  const extendsBeacon = backupContent.startsWith(beacon.content);
  const hasMoreLines = splitLines(backupContent).length > splitLines(beacon.content).length;
  return extendsBeacon && hasMoreLines;
}

// s27: append a backup Write when the terminal beacon was truncated, so replay ends with complete content.
export function appendTruncatedBeaconCompletion(
  records: TranscriptRecord[],
  events: FileEvent[],
  reader: BackupReader,
): FileEvent[] {
  const last = events[events.length - 1];
  const lastIsUserEdit = last !== undefined && last.kind === EventKind.userEdit;
  if (!lastIsUserEdit) {
    return events;
  }
  const seed = latestBackupWriteFor(records, last.target, reader);
  if (seed === undefined) {
    return events;
  }
  const seedCompletesBeacon = isBeaconTruncated(last, seed.content);
  if (!seedCompletesBeacon) {
    return events;
  }
  noteStage({
    stage: "completeTruncatedBeacon",
    target: last.target,
    changeId: last.changeId,
    detail: "appended a synthetic Write completing a truncated terminal user-edit beacon",
    when: seed.timestamp,
  });
  return [...events, seed];
}
