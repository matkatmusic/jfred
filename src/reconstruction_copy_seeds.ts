// Copy-event seeding for the per-file repair chain, split from reconstruction_branches.ts.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { getFileRevisionsOver } from "./reconstruction_branches.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { findLastRevisionAtOrBefore, getLinesText } from "./reconstruction_revisions.ts";
import type { CopyEvent, FileEvent } from "./reconstruction_events.ts";

// Fill each copy event's seedLines from its source; pass other events through.
export function fillCopySeeds(
  records: TranscriptRecord[],
  lineage: FileEvent[],
  resolving: Set<string>,
  reader?: BackupReader,
): FileEvent[] {
  const seeded: FileEvent[] = [];
  for (const event of lineage) {
    if (event.kind === EventKind.copy) {
      seeded.push(fillOneCopySeed(records, event, resolving, reader));
      continue;
    }
    seeded.push(event);
  }
  return seeded;
}

// Seed one copy with the source file's content as of the copy timestamp.
function fillOneCopySeed(
  records: TranscriptRecord[],
  event: CopyEvent,
  resolving: Set<string>,
  reader?: BackupReader,
): CopyEvent {
  const destination = event.to.toString();
  const isCopyCycle = resolving.has(destination);
  if (isCopyCycle) {
    return { ...event, seedLines: [] };
  }
  const next = new Set(resolving);
  next.add(destination);
  const sourceRevisions = getFileRevisionsOver(records, event.from, next, reader);
  const atCopy = findLastRevisionAtOrBefore(sourceRevisions, event.timestamp);
  if (!atCopy) {
    return { ...event, seedLines: [] };
  }
  noteStage({ stage: "seedCopyEvents", target: event.to, changeId: event.changeId, detail: `seeded copy genesis from ${event.from}`, when: event.timestamp });
  return { ...event, seedLines: getLinesText(atCopy) };
}
