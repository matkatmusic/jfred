// Built on the branch-agnostic core, so disk keeps abandoned-branch writes after a conv-only rewind.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import {
  findLastRevisionAtOrBefore,
  getLinesText,
} from "./reconstruction_revisions.ts";
import { getFileHistoriesOver } from "./reconstruction_renderable.ts";
import type { FileHistory, RenameInfo } from "./reconstruction_events.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// A file absent at the step is simply not a key.
export type RepoSnapshot = ReadonlyMap<Path, string>;

// One step is one millisecond, so a mismatch can name the JSONL records behind the step.
export type StepChange = { when: Date; changeIds: Uuid[] };

type RenameEvent = { timestamp: Date; rename: RenameInfo };

function compareDates(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

function compareRenameTimes(a: RenameEvent, b: RenameEvent): number {
  return a.timestamp.getTime() - b.timestamp.getTime();
}

// Two revisions sharing a timestamp are one step, so timestamps de-duplicate by millisecond value.
function collectChangeTimes(histories: FileHistory[]): Date[] {
  const byMillis = new Map<number, Date>();
  for (const history of histories) {
    for (const revision of history.revisions) {
      byMillis.set(revision.timestamp.getTime(), revision.timestamp);
    }
  }
  return [...byMillis.values()].sort(compareDates);
}

function collectRenameEvents(history: FileHistory): RenameEvent[] {
  const events: RenameEvent[] = [];
  for (const revision of history.revisions) {
    const rename = revision.rename;
    if (rename !== undefined) {
      events.push({ timestamp: revision.timestamp, rename });
    }
  }
  return events.sort(compareRenameTimes);
}

// ponytail: two lineages resolving to the same name-at-time have the later win; revisit if seen.
function findPathAtTime(history: FileHistory, when: Date): Path {
  const renames = collectRenameEvents(history);
  if (renames.length === 0) {
    return history.target;
  }
  let latestAtOrBefore: RenameEvent | undefined;
  for (const event of renames) {
    const isAtOrBefore = event.timestamp.getTime() <= when.getTime();
    if (isAtOrBefore) {
      latestAtOrBefore = event;
    }
  }
  if (latestAtOrBefore !== undefined) {
    return latestAtOrBefore.rename.to;
  }
  return renames[0]!.rename.from;
}

// Keyed by the name the file held AT `when`, so a step before a rename shows the old name.
export function computeRepoStateAtTime(histories: FileHistory[], when: Date): RepoSnapshot {
  const snapshot = new Map<Path, string>();
  for (const history of histories) {
    const revision = findLastRevisionAtOrBefore(history.revisions, when);
    if (revision !== undefined) {
      // The engine drops the file's single trailing newline at replay, so this omits it too.
      snapshot.set(findPathAtTime(history, when), getLinesText(revision).join("\n"));
    }
  }
  return snapshot;
}

// Plain-object form because a RepoSnapshot Map stringifies to `{}`; resolved on demand to bound wire size.
export function computeFilesAtStep(histories: FileHistory[], when: Date): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, text] of computeRepoStateAtTime(histories, when)) {
    files[path.toString()] = text;
  }
  return files;
}

function collectChangeIdsAt(histories: FileHistory[], when: Date): Uuid[] {
  const changeIds: Uuid[] = [];
  for (const history of histories) {
    for (const revision of history.revisions) {
      const isAtInstant = revision.timestamp.getTime() === when.getTime();
      if (isAtInstant) {
        changeIds.push(revision.changeId);
      }
    }
  }
  return changeIds;
}

// Both come from ONE reconstruction pass; per-step repo states are resolved on demand.
export type StepTimeline = { histories: FileHistory[]; changes: StepChange[] };

export function buildStepTimeline(
  records: TranscriptRecord[],
  reader?: BackupReader,
): StepTimeline {
  reportReconstructionProgress(`reconstructing step states from ${records.length} transcript records`);
  const histories = getFileHistoriesOver(records, reader);
  const changes: StepChange[] = [];
  for (const when of collectChangeTimes(histories)) {
    changes.push({ when, changeIds: collectChangeIdsAt(histories, when) });
  }
  return { histories, changes };
}

// Reconstructs over EXACTLY the given records, with no surviving-branch filter, so the timeline is literal disk.
export function buildStepStates(
  records: TranscriptRecord[],
  reader?: BackupReader,
): RepoSnapshot[] {
  const { histories, changes } = buildStepTimeline(records, reader);
  const states: RepoSnapshot[] = [];
  for (const change of changes) {
    states.push(computeRepoStateAtTime(histories, change.when));
  }
  return states;
}

// Counted from the change instants without materializing any repo state.
export function countStepsInTranscript(
  records: TranscriptRecord[],
  reader?: BackupReader,
): number {
  return buildStepTimeline(records, reader).changes.length;
}

// Same order and count as buildStepStates, so stepChanges[i] explains steps[i].
export function buildStepChanges(
  records: TranscriptRecord[],
  reader?: BackupReader,
): StepChange[] {
  return buildStepTimeline(records, reader).changes;
}
