// Placement stage: splice committed-blob diffs as synthetic user edits (s85).

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { findGitAddEvents, findGitCommitEvents, type GitAddEvent, type GitCommitEvent } from "./reconstruction_git_commit_events.ts";
import { findFallbackRepoDirs, readCommittedFileContent, readStagedFileContent } from "./reconstruction_git_evidence.ts";
import { findBlobDiffPlacement } from "./reconstruction_git_splice.ts";

// One commit's blob for `target`, resolved from the recorded repo (with decay fallbacks).
function findCommitDiffPlacement(
  commit: GitCommitEvent,
  events: FileEvent[],
  runs: ScriptRun[],
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
): FileEvent[] | undefined {
  if (commit.cwd === undefined)
    return undefined;
  // item 46: const blob = readCommittedFileContent(commit.cwd, commit.timestamp, target, findPreservedRepoDir(records));
  const blob = readCommittedFileContent(commit.cwd, commit.timestamp, target, findFallbackRepoDirs(records));
  if (blob === undefined)
    return undefined;
  return findBlobDiffPlacement(blob, commit.timestamp, events, runs, target, records, reader);
}

// The latest recorded `git add` of `target`; later records win ties.
export function findLastAddOfTarget(records: TranscriptRecord[], target: Path): GitAddEvent | undefined {
  const adds = findGitAddEvents(records);
  let lastAdd: GitAddEvent | undefined;
  for (const add of adds) {
    const isTarget = add.path.equals(target);
    if (!isTarget)
      continue;
    const addTime = add.timestamp.getTime();
    const lastTime = lastAdd === undefined ? -Infinity : lastAdd.timestamp.getTime();
    if (addTime >= lastTime)
      lastAdd = add;
  }
  return lastAdd;
}

// Place the staged blob from the last recorded `git add` for this target.
function findStagedBlobPlacement(
  records: TranscriptRecord[],
  events: FileEvent[],
  runs: ScriptRun[],
  target: Path,
  reader: BackupReader,
): FileEvent[] | undefined {
  const lastAdd = findLastAddOfTarget(records, target);
  if (lastAdd === undefined)
    return undefined;
  if (lastAdd.cwd === undefined)
    return undefined;
  const blob = readStagedFileContent(lastAdd.cwd, target, findFallbackRepoDirs(records));
  if (blob === undefined)
    return undefined;
  return findBlobDiffPlacement(blob, lastAdd.timestamp, events, runs, target, records, reader);
}

// Splice unexplained pure-addition diffs from git commits/adds as synthetic edits (s85, s87).
export function applyGitCommitEvidence(
  records: TranscriptRecord[],
  events: FileEvent[],
  reader: BackupReader,
  target: Path,
): FileEvent[] {
  const isAllowed = isImpureExecutionAllowed();
  if (!isAllowed)
    return events;
  const runs = findScriptExecutionRuns(records);
  for (const commit of findGitCommitEvents(records)) {
    const placed = findCommitDiffPlacement(commit, events, runs, target, records, reader);
    if (placed !== undefined)
      return placed;
  }
  const placedFromStage = findStagedBlobPlacement(records, events, runs, target, reader);
  if (placedFromStage !== undefined)
    return placedFromStage;
  return events;
}
