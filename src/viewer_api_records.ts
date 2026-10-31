// Transcript-record layer: freshness stamp, parsed-records cache with throttled progress, and chronological session merge.

import { statSync } from "node:fs";
import { formatRecordSourceToken, getRecordSource, loadTranscript, type ProgressSink, type SkippedLine } from "./parse/loadTranscript.ts";
import { getCachedValueRefreshingRecency, removeLeastRecentlyUsedEntries } from "./cache_lru.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// Announce one build stage (a no-op when no sink is listening).
export function reportStage(onProgress: ProgressSink | undefined, label: string): void {
  onProgress?.({ kind: DocumentResponseKind.progress, label });
}

// ponytail: misses same-millisecond same-size rewrites; use content hashing if needed.
export function computeTranscriptFileStamp(path: Path): string {
  const stats = statSync(path.toString());
  return `${path.toString()}:${stats.mtimeMs}:${stats.size}`;
}

// Sorted "path:mtimeMs:size" segments.
export function computeTranscriptSetStamp(jsonlPaths: Path[]): string {
  const stampSegments: string[] = [];
  for (const path of jsonlPaths) {
    stampSegments.push(computeTranscriptFileStamp(path));
  }
  stampSegments.sort();
  return stampSegments.join("|");
}

export const PROGRESS_LABEL_RECORDS_CACHE_HIT = "reusing cached transcript records";

// Bound for both viewer caches: documents are large, so unbounded growth leaks. ponytail: raise if thrash shows.
export const ARTIFACT_CACHE_CAPACITY = 8;

// Parsed records plus skipped lines, cached together so a warm rebuild still reports its gaps.
export type ProjectRecords = { records: TranscriptRecord[]; skippedLines: SkippedLine[] };

// Parsed records per stamp: a file touch changes the stamp, so stale entries age out via LRU.
const parsedRecordsCache = new Map<string, ProjectRecords>();

// Item 82: replay progress at a stride, so at most RECORD_PROGRESS_MAX_LINES lines go out.
export const RECORD_PROGRESS_MAX_LINES = 50;

export function computeRecordProgressStride(total: number): number {
  return Math.max(1, Math.ceil(total / RECORD_PROGRESS_MAX_LINES));
}

function emitRecordProgress(records: TranscriptRecord[], onProgress: ProgressSink | undefined): void {
  if (onProgress === undefined) {
    return;
  }
  const stride = computeRecordProgressStride(records.length);
  for (const [index, record] of records.entries()) {
    const isSampled = (index + 1) % stride === 0;
    const isLast = index === records.length - 1;
    const isUnsampled = !isSampled;
    const isNotLast = !isLast;
    const isSkipped = isUnsampled && isNotLast;
    if (isSkipped) {
      continue;
    }
    onProgress({
      kind: DocumentResponseKind.progress,
      label: `${record.type}${formatRecordSourceToken(getRecordSource(record))}`,
      current: index + 1,
      total: records.length,
    });
  }
}

// Merged records plus skips, parsed once per on-disk state; the SAME array keeps engine memos warm.
export function loadProjectRecords(jsonlPaths: Path[], onProgress?: ProgressSink): ProjectRecords {
  const stamp = computeTranscriptSetStamp(jsonlPaths);
  const cached = getCachedValueRefreshingRecency(parsedRecordsCache, stamp);
  if (cached !== undefined) {
    reportStage(onProgress, PROGRESS_LABEL_RECORDS_CACHE_HIT);
    emitRecordProgress(cached.records, onProgress);
    return cached;
  }
  // Tolerant parse: unknown record types and malformed lines are skipped and captured as SkippedLine gaps.
  const skippedLines: SkippedLine[] = [];
  const recordLists: TranscriptRecord[][] = [];
  for (const path of jsonlPaths) {
    const transcript = loadTranscript(path.toString(), onProgress, true);
    skippedLines.push(...transcript.skippedLines);
    recordLists.push(transcript.records);
  }
  sortTranscriptsChronologically(recordLists);
  const loaded = { records: recordLists.flat(), skippedLines };
  parsedRecordsCache.set(stamp, loaded);
  removeLeastRecentlyUsedEntries(parsedRecordsCache, ARTIFACT_CACHE_CAPACITY);
  return loaded;
}

// The first stamped record's timestamp, for ordering whole transcripts; a transcript with no timestamp sorts last (stably).
function findFirstTimestamp(records: TranscriptRecord[]): number | undefined {
  for (const record of records) {
    if (record.timestamp !== undefined) {
      return record.timestamp.getTime();
    }
  }
  return undefined;
}

// Callers pass newest-first paths; the engine needs sessions oldest first. Intra-file order is untouched.
function sortTranscriptsChronologically(transcripts: TranscriptRecord[][]): void {
  transcripts.sort(compareFirstTimestamps);
}

function compareFirstTimestamps(a: TranscriptRecord[], b: TranscriptRecord[]): number {
  return (findFirstTimestamp(a) ?? Number.POSITIVE_INFINITY) - (findFirstTimestamp(b) ?? Number.POSITIVE_INFINITY);
}
