// Lineage-seed texts for script replay, memoized per records identity by horizon (task 220, task 162).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
  enterLineageReplayWindow,
  restoreLineageReplayWindow,
} from "./reconstruction_script_runs.ts";
import {
  doesReplayWindowKeepInstant,
  findServableLineageSeed,
  isLineageKeyOnReplayStack,
  noteLineageCacheServe,
  recordLineageGuardHit,
  recordLineageKeyQuery,
  runLineageReplayFrame,
  storeLineageSeedWhenCacheable,
} from "./reconstruction_lineage_memo.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import { computeLineageSeedHorizonKey } from "./reconstruction_lineage_horizon.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { getFileRevisionsOver } from "./reconstruction_branches.ts";
import { lastRevisionStrictlyBefore, linesTextOf } from "./reconstruction_revisions.ts";
import type { FileRevision } from "./reconstruction_events.ts";

// The seed text of a replayed revision, or undefined when the lineage has no revision to offer.
function computeSeededText(revisionBefore: FileRevision | undefined): string | undefined {
  if (revisionBefore === undefined)
    return undefined;
  // Restore the trailing newline splitLines drops: the stage's byte-exact beacon compare needs it.
  return linesTextOf(revisionBefore).join("\n") + "\n";
}

// Replay the target's own reconstruction and return its seed text just before `before`.
function computeReplayedSeedText(
  records: TranscriptRecord[],
  reader: BackupReader,
  target: Path,
  before: Date,
): string | undefined {
  const revisions = getFileRevisionsOver(records, target, new Set(), reader);
  return computeSeededText(lastRevisionStrictlyBefore(revisions, before));
}

// Replay the target's own reconstruction up to `before`, serving the memo when proven safe.
function computeLineageContentBefore(
  records: TranscriptRecord[],
  reader: BackupReader,
  target: Path,
  before: Date,
): string | undefined {
  const cycleKey = `${target.toString()}|${before.getTime()}`;
  recordLineageKeyQuery(cycleKey);
  const isKeyOnStack = isLineageKeyOnReplayStack(cycleKey);
  if (isKeyOnStack) {
    recordLineageGuardHit(cycleKey);
    return undefined;
  }
  const seedsByKey = getDerivedCaches(records, reader).lineageSeedsByKey;
  const seedKey = computeLineageSeedHorizonKey(records, reader, target, before);
  const previousCutoff = enterLineageReplayWindow(before);
  try {
    // Cache valid only when memo module proves replay identical to fresh compute (task 162).
    const windowKeptInstant = doesReplayWindowKeepInstant(previousCutoff, before);
    const servableEntry = findServableLineageSeed(seedsByKey, seedKey, windowKeptInstant);
    if (servableEntry !== null) {
      noteLineageCacheServe(servableEntry);
      return servableEntry.text;
    }
    reportReconstructionProgress(`replaying lineage of ${target}`);
    const computeFrameText = () => computeReplayedSeedText(records, reader, target, before);
    const replayed = runLineageReplayFrame(cycleKey, computeFrameText);
    storeLineageSeedWhenCacheable(seedsByKey, seedKey, replayed.cacheable, windowKeptInstant);
    return replayed.text;
  }
  finally {
    restoreLineageReplayWindow(previousCutoff);
  }
}

// A LineageContentBefore that replays the target's own reconstruction up to `before`.
export function getLineageContentBefore(records: TranscriptRecord[], reader: BackupReader): LineageContentBefore {
  return (target, before) => computeLineageContentBefore(records, reader, target, before);
}
