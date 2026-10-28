// Branch-aware reconstruction core, split from reconstruction_engine.ts for the 250-line cap.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { collectRevisions } from "./reconstruction_replay.ts";
import { addEditBaseFromBackup } from "./reconstruction_sidecar.ts";
import { fillRedirectContent } from "./reconstruction_sidecar_redirect.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { insertElidedBeaconSeeds } from "./reconstruction_beacons.ts";
import { appendTruncatedBeaconCompletion } from "./reconstruction_beacons_truncated.ts";
import { applyScriptExecutions } from "./reconstruction_script_stage.ts";
import { appendScriptMoveRenames } from "./reconstruction_script_move_events.ts";
import { countActiveLineageReplayFrames } from "./reconstruction_lineage_memo.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import { applyGitCommitEvidence } from "./reconstruction_git_placement.ts";
import { insertBaseCommitBeacon } from "./reconstruction_base_commit.ts";
import { insertStaleEditBaseSeeds } from "./reconstruction_reseed.ts";
import {
  buildRenameChain,
  eventBelongsToLineage,
  resolveFinalPath,
} from "./reconstruction_lineage.ts";
import { executeStageTolerantly } from "./reconstruction_stage_runner.ts";
import { fillCopySeeds } from "./reconstruction_copy_seeds.ts";
import { getLineageContentBefore } from "./reconstruction_lineage_content.ts";
import type { FileEvent, FileRevision } from "./reconstruction_events.ts";

// Per-file revisions over the given records; only pure top-level calls are cached.
export function getFileRevisionsOver(
  records: TranscriptRecord[],
  target: Path,
  resolving: Set<string>,
  reader?: BackupReader,
): FileRevision[] {
  const isNestedCall = resolving.size > 0;
  const hasActiveReplayFrames = countActiveLineageReplayFrames() > 0;
  const isStackDependent = isNestedCall || hasActiveReplayFrames;
  if (isStackDependent) {
    return computeFileRevisionsOver(records, target, resolving, reader);
  }
  const byTarget = getDerivedCaches(records, reader).historiesByTarget;
  const targetKey = target.toString();
  const cached = byTarget.get(targetKey);
  if (cached !== undefined) {
    return cached;
  }
  const revisions = computeFileRevisionsOver(records, target, resolving, reader);
  byTarget.set(targetKey, revisions);
  return revisions;
}

function computeFileRevisionsOver(
  records: TranscriptRecord[],
  target: Path,
  resolving: Set<string>,
  reader?: BackupReader,
): FileRevision[] {
  const extracted = extractFileEvents(records);
  // task 155: sandbox-proven script moves join the chain for lineage resolution.
  const events = reader
    ? executeStageTolerantly("appendScriptMoveRenames", target, extracted, appendScriptMoveRenames, extracted, records, reader, getLineageContentBefore(records, reader))
    : extracted;
  const renameChain = buildRenameChain(events);
  const finalTarget = resolveFinalPath(target, renameChain);
  const lineage: FileEvent[] = [];
  for (const event of events) {
    const belongsToLineage = eventBelongsToLineage(event, finalTarget, renameChain);
    if (belongsToLineage) {
      lineage.push(event);
    }
  }
  // task 119: each stage degrades to its input on throw instead of killing the file.
  const baselined = executeStageTolerantly("seedBaseCommitBeacon", finalTarget, lineage, insertBaseCommitBeacon, records, lineage, finalTarget);
  const seeded = executeStageTolerantly("seedCopyEvents", finalTarget, baselined, fillCopySeeds, records, baselined, resolving, reader);
  const filled = reader ? executeStageTolerantly("fillRedirectContent", finalTarget, seeded, fillRedirectContent, records, seeded, reader) : seeded;
  const based = reader ? executeStageTolerantly("seedEditBaseFromBackup", finalTarget, filled, addEditBaseFromBackup, records, filled, reader) : filled;
  const scripted = reader
    ? executeStageTolerantly("injectScriptExecutions", finalTarget, based, applyScriptExecutions, records, based, reader, finalTarget, getLineageContentBefore(records, reader))
    : based;
  const evidenced = reader ? executeStageTolerantly("placeGitCommitEvidence", finalTarget, scripted, applyGitCommitEvidence, records, scripted, reader, finalTarget) : scripted;
  const unelided = reader ? executeStageTolerantly("completeElidedBeacons", finalTarget, evidenced, insertElidedBeaconSeeds, records, evidenced, reader) : evidenced;
  const restaged = reader ? executeStageTolerantly("seedStaleEditBases", finalTarget, unelided, insertStaleEditBaseSeeds, records, unelided, reader) : unelided;
  const completed = reader ? executeStageTolerantly("completeTruncatedBeacon", finalTarget, restaged, appendTruncatedBeaconCompletion, records, restaged, reader) : restaged;
  return collectRevisions(completed);
}
