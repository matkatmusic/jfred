// Splices a tier-1 WriteEvent from the configured base commit into each file's event lineage.

import { relative } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_events.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { findBaseCommitEvidenceForTarget, readCommitFileContent, readCommitTimestamp } from "./reconstruction_base_commit_evidence.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { noteStage } from "./reconstruction_provenance.ts";

export const BASE_COMMIT_CHANGE_ID_PREFIX = "gitBase:";

// Task 56: controls whether pre-beacon events are replayed or dropped.
let preBaselineReconstructionAllowed = true;

export function setPreBaselineReconstructionAllowed(allowed: boolean): void {
  preBaselineReconstructionAllowed = allowed;
}

// Task 151: cache-group key — different answers must not share derived caches.
export function isPreBaselineReconstructionAllowed(): boolean {
  return preBaselineReconstructionAllowed;
}

// Task 151: memoized cutoff instant; runs at-or-before it are skipped.
let skippedBaselineCutoffCache: { cachedFor: string; cutoff: Date | undefined } | undefined;

export function computeSkippedBaselineCutoff(): Date | undefined {
  if (preBaselineReconstructionAllowed) {
    return undefined;
  }
  const { repoDir, baseCommit } = getPathOverrides();
  if (repoDir === undefined) {
    return undefined;
  }
  if (baseCommit === undefined) {
    return undefined;
  }
  const cachedFor = `${repoDir.toString()}|${baseCommit.toString()}`;
  if (skippedBaselineCutoffCache?.cachedFor !== cachedFor) {
    skippedBaselineCutoffCache = { cachedFor, cutoff: readCommitTimestamp(repoDir, baseCommit) };
  }
  return skippedBaselineCutoffCache.cutoff;
}

// Task 151: true when this run is superseded by a declined baseline.
export function isTimestampAtOrBeforeSkippedBaseline(timestamp: Date): boolean {
  const cutoff = computeSkippedBaselineCutoff();
  if (cutoff === undefined) {
    return false;
  }
  return timestamp.getTime() <= cutoff.getTime();
}

// Deterministic changeId so every replay of the same baseline agrees.
export function computeBaseCommitChangeId(baseCommit: Uuid, target: Path): Uuid {
  return new Uuid(`${BASE_COMMIT_CHANGE_ID_PREFIX}${baseCommit.toString()}:${target.toString()}`);
}

// Splices a tier-1 beacon WriteEvent if the base commit contains this target.
export function insertBaseCommitBeacon(records: TranscriptRecord[], events: FileEvent[], target: Path): FileEvent[] {
  const evidence = findBaseCommitEvidenceForTarget(records, target);
  if (evidence === undefined) {
    return events;
  }
  const { repoDir, baseCommit, relativeRoot } = evidence;
  const relativePath = relative(relativeRoot.toString(), target.toString());
  if (relativePath === "") {
    return events;
  }
  const isOutsideRoot = relativePath.startsWith("..");
  if (isOutsideRoot) {
    return events;
  }
  const timestamp = readCommitTimestamp(repoDir, baseCommit);
  if (timestamp === undefined) {
    // Commit unreadable despite being configured — note as missing evidence.
    noteReconstructionFailure({ scope: FailureScope.fileStage, stage: "seedBaseCommitBeacon", target, reason: "git baseline commit unreadable (recorded repo missing)" });
    return events;
  }
  const content = readCommitFileContent(repoDir, baseCommit, relativePath);
  if (content === undefined) {
    return events;
  }
  const changeId = computeBaseCommitChangeId(baseCommit, target);
  const beacon: WriteEvent = { kind: EventKind.write, changeId, target, content, timestamp };
  // Insert before the first event after the beacon's timestamp.
  const timestampMs = timestamp.getTime();
  let followerIndex = -1;
  for (const [index, event] of events.entries()) {
    const eventMs = event.timestamp.getTime();
    if (eventMs > timestampMs) {
      followerIndex = index;
      break;
    }
  }
  const insertionIndex = followerIndex === -1 ? events.length : followerIndex;
  if (!preBaselineReconstructionAllowed) {
    // Task 56: drop pre-baseline events the beacon supersedes.
    const trimmed = [beacon, ...events.slice(insertionIndex)];
    noteStage({
      stage: "seedBaseCommitBeacon",
      target,
      changeId,
      detail: `seeded a tier-1 write beacon and dropped ${insertionIndex} superseded pre-baseline event(s)`,
      when: timestamp,
    });
    return trimmed;
  }
  const seeded = [...events];
  seeded.splice(insertionIndex, 0, beacon);
  noteStage({
    stage: "seedBaseCommitBeacon",
    target,
    changeId,
    detail: "seeded a tier-1 write beacon from the configured base commit",
    when: timestamp,
  });
  return seeded;
}
