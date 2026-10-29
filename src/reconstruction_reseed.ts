// Backup-driven reseeding of stale edit bases; reader-only. Design: plans/s34/s34-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { getBackupSeedWrite, normalizeSeedBetweenPreviousAndEdit } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { addStageEntry } from "./reconstruction_provenance.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_events.ts";
import { isEditBaseStale } from "./reconstruction_reseed_base.ts";
import { findOutOfWindowEditSeed, findReversedEditBaseSeed } from "./reconstruction_reseed_seeds.ts";

// The Write spliced before `event` when its base is stale or out-of-window, else undefined.
function findStaleEditSeed(
  records: TranscriptRecord[],
  event: FileEvent,
  priorEvents: FileEvent[],
  reader: BackupReader,
): WriteEvent | undefined {
  if (event.kind !== EventKind.edit) {
    return undefined;
  }
  const isStale = isEditBaseStale(event, priorEvents);
  if (isStale) {
    // s28 reversed base first, then the s19/s23/m6 backup seed.
    const reversedSeed = findReversedEditBaseSeed(records, event, reader);
    return reversedSeed ?? getBackupSeedWrite(records, event.target, event.timestamp, reader, true);
  }
  return findOutOfWindowEditSeed(records, event, priorEvents, reader); // s34
}

// Record that a stale-edit-base reseed fired, tagging the edit it seeds.
function reportStaleSeed(event: FileEvent, seed: WriteEvent): void {
  addStageEntry({
    stage: "seedStaleEditBases",
    target: seed.target,
    changeId: event.kind === EventKind.edit ? event.changeId : seed.changeId,
    detail: "reseeded a stale mid-stream edit base from the file-history backup",
    when: seed.timestamp,
  });
}

// Splice a backup-seed Write before each stale-base edit (s19); intact edits stay unchanged.
export function insertStaleEditBaseSeeds(
  records: TranscriptRecord[],
  lineage: FileEvent[],
  reader: BackupReader,
): FileEvent[] {
  const result: FileEvent[] = [];
  for (const event of lineage) {
    const rawSeed = findStaleEditSeed(records, event, result, reader);
    if (rawSeed) {
      // task 224: the seed stamp can sit outside the event it follows and the edit it seeds.
      const seed = normalizeSeedBetweenPreviousAndEdit(rawSeed, event.timestamp, result[result.length - 1]?.timestamp);
      reportStaleSeed(event, seed);
      result.push(seed);
    }
    result.push(event);
  }
  return result;
}
