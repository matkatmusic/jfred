// Helpers for viewer_api.ts: record selection, cache key, process gates, and the pre-baseline stamp of one build.

import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { getPathOverrides, formatPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords, splitRecordsBySession } from "./reconstruction_multi_source.ts";
import { setPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";
import { trimRecordsAtRevisionTurnEnd, type RevisionBoundRequest } from "./reconstruction_bound.ts";
import { setImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { setReconstructionProgressSink } from "./reconstruction_progress.ts";
import { computeTranscriptSetStamp } from "./viewer_api_records.ts";

// Spec S5a: the merge builds a NEW array, so per-records WeakMap memos run cold on multi-source builds.
// ponytail: memoize per (stamp, sources) if profiling ever shows it.
export function selectBuildRecords(loadedRecords: TranscriptRecord[], sources?: SourceEntry[], bound?: RevisionBoundRequest): TranscriptRecord[] {
  const merged = sources === undefined || sources.length === 0
    ? loadedRecords
    : mergeMultiSourceRecords(splitRecordsBySession(loadedRecords), sources);
  // Task 194: the bound cut must happen BEFORE any engine work, like the CLI's --until-revision.
  return bound === undefined
    ? merged
    : trimRecordsAtRevisionTurnEnd(merged, bound.file, bound.ordinal).records;
}

// Each build kind gets its own cache entry; the key includes active overrides, so config edits miss.
export function computeBuildCacheKey(jsonlPaths: Path[], target: Path | undefined, allowScripts: boolean, reconstructPreBaseline: boolean, bound?: RevisionBoundRequest): string {
  const targetKey = target === undefined ? "" : target.toString();
  const boundKey = bound === undefined ? "" : `${bound.file.toString()}#${bound.ordinal}`;
  return `${computeTranscriptSetStamp(jsonlPaths)}|${allowScripts}|${reconstructPreBaseline}|${targetKey}|${boundKey}|${formatPathOverrides()}`;
}

export function applyBuildGates(allowScripts: boolean, reconstructPreBaseline: boolean, onProgress?: ProgressSink): void {
  setImpureExecutionAllowed(allowScripts);
  setPreBaselineReconstructionAllowed(reconstructPreBaseline);
  setReconstructionProgressSink(onProgress);
}

export function resetBuildGates(): void {
  setImpureExecutionAllowed(false);
  setPreBaselineReconstructionAllowed(true);
  setReconstructionProgressSink(undefined);
}

// Stamped BEFORE caching: cached copies must carry the flag their cache key promises.
export function markPreBaselineSkipped(built: BuiltReconstruction, reconstructPreBaseline: boolean): void {
  const hasBaseCommit = getPathOverrides().baseCommit !== undefined;
  const isPreBaselineSkipped = !reconstructPreBaseline && hasBaseCommit;
  if (isPreBaselineSkipped) {
    built.document.preBaselineSkipped = true;
  }
}
