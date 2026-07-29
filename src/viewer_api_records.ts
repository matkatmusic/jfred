// The viewer's transcript-record layer: a freshness stamp per transcript set, the parsed-records LRU cache with throttled per-record progress replay, and the chronological multi-session merge — everything between JSONL paths and a merged record stream (plus its tolerant-parse skips).

import { statSync } from "node:fs";
import { formatRecordSourceToken, getRecordSource, loadTranscript, type ProgressSink, type SkippedLine } from "./parse/loadTranscript.ts";
import { getCachedValueRefreshingRecency, evictLeastRecentlyUsedEntries } from "./cache_lru.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// Announce one build stage (a no-op when no sink is listening).
export function reportStage(onProgress: ProgressSink | undefined, label: string): void {
    onProgress?.({ kind: DocumentResponseKind.progress, label });
}

// One string identifying a transcript set's on-disk state: sorted "path:mtimeMs:size" segments.  Two calls agree exactly when no file was added, removed, or modified. ponytail: mtimeMs+size misses a same-millisecond same-size rewrite — switch to content hashing if that ever bites.
export function computeTranscriptSetStamp(jsonlPaths: Path[]): string {
    const stampSegments = jsonlPaths.map((path) => {
        const stats = statSync(path.toString());
        return `${path.toString()}:${stats.mtimeMs}:${stats.size}`;
    });
    stampSegments.sort();
    return stampSegments.join("|");
}

export const PROGRESS_LABEL_RECORDS_CACHE_HIT = "reusing cached transcript records";

// Bound for both viewer caches. Documents carry full per-step file snapshots, so unbounded growth is a real leak on a long-running localhost server. 8 fits one project-wide artifact plus a healthy run of per-conversation entries without evicting the big one (reads refresh recency). ponytail: raise if hit/miss thrash ever shows in the loading console.
export const ARTIFACT_CACHE_CAPACITY = 8;

// The parsed record stream for a transcript set plus every line the tolerant parse skipped — cached together so a warm rebuild still reports its gaps.
export type ProjectRecords = { records: TranscriptRecord[]; skippedLines: SkippedLine[] };

// Parsed records per transcript-set stamp. Entries never go stale silently: a file touch changes the stamp, so a stale entry is simply never keyed again and ages out via LRU.
const parsedRecordsCache = new Map<string, ProjectRecords>();

// A cache hit must still show counted per-record progress (never silence the console), but one line per record floods the stream with 20k+ lines for a large project (item 82 — the captured jot-backup load emitted 20,418). Emit at a stride so at most RECORD_PROGRESS_MAX_LINES lines go out, always including the final record so the bar reaches 100%. Sampled lines keep the clickable "[<jsonl>:<line>]" source token.
export const RECORD_PROGRESS_MAX_LINES = 50;

export function computeRecordProgressStride(total: number): number {
    return Math.max(1, Math.ceil(total / RECORD_PROGRESS_MAX_LINES));
}

function replayRecordProgress(records: TranscriptRecord[], onProgress: ProgressSink | undefined): void {
    if (onProgress === undefined) {
        return;
    }
    const stride = computeRecordProgressStride(records.length);
    records.forEach((record, index) => {
        const isSampled = (index + 1) % stride === 0;
        const isLast = index === records.length - 1;
        if (!isSampled && !isLast) {
            return;
        }
        onProgress({
            kind: DocumentResponseKind.progress,
            label: `${record.type}${formatRecordSourceToken(getRecordSource(record))}`,
            current: index + 1,
            total: records.length,
        });
    });
}

// The parsed, merged record stream for a transcript set (with its tolerant-parse skips) — parsed at most once per on-disk state. Returning the SAME records array object also keeps the engine's per-records WeakMap memos (reconstruction_branches.ts) warm across requests.
export function loadProjectRecords(jsonlPaths: Path[], onProgress?: ProgressSink): ProjectRecords {
    const stamp = computeTranscriptSetStamp(jsonlPaths);
    const cached = getCachedValueRefreshingRecency(parsedRecordsCache, stamp);
    if (cached !== undefined) {
        reportStage(onProgress, PROGRESS_LABEL_RECORDS_CACHE_HIT);
        replayRecordProgress(cached.records, onProgress);
        return cached;
    }
    // The viewer opens arbitrary real sessions: tolerate (and log) fields the scenarios never modeled instead of hard-failing the whole document; unknown record types and malformed lines are skipped and captured (the SkippedLine gaps the webapp renders).
    const transcripts = jsonlPaths.map((path) => loadTranscript(path.toString(), onProgress, true));
    const skippedLines = transcripts.flatMap((loaded) => loaded.skippedLines);
    const recordLists = transcripts.map((loaded) => loaded.records);
    sortTranscriptsChronologically(recordLists);
    const loaded = { records: recordLists.flat(), skippedLines };
    parsedRecordsCache.set(stamp, loaded);
    evictLeastRecentlyUsedEntries(parsedRecordsCache, ARTIFACT_CACHE_CAPACITY);
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

// Whole-session chronology: the branch model and every "last head = latest" heuristic assume the merged record stream is time-ordered ACROSS sessions (it always is within one). Callers hand paths in UI order (newest first), so re-order here, oldest session first; intra-file order is untouched.
function sortTranscriptsChronologically(transcripts: TranscriptRecord[][]): void {
    transcripts.sort((a, b) =>
        (findFirstTimestamp(a) ?? Number.POSITIVE_INFINITY) - (findFirstTimestamp(b) ?? Number.POSITIVE_INFINITY));
}
