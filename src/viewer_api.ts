// Document-build layer: builds ReconstructionDocuments, decides script-execution consent, and caches results; HTTP wiring and other concerns live in sibling viewer_api_*.ts files.

import type { ProgressSink } from "./parse/loadTranscript.ts";
import {
    buildReconstructionDocument,
    type ReconstructionDocument,
    type BuiltReconstruction,
} from "./reconstruction_json.ts";
import { reconstructBranches } from "./reconstruction_engine.ts";
import { clearReconstructionFailures } from "./reconstruction_health.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { getPathOverrides, serializePathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords, groupRecordsBySession } from "./reconstruction_multi_source.ts";
import { setPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";
import { truncateRecordsAtRevisionTurnEnd, type RevisionBoundRequest } from "./reconstruction_bound.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { scriptCodeMayWriteFiles } from "./reconstruction_script_prestate.ts";
import { flushSandboxMemoToDisk } from "./reconstruction_script_sandbox.ts";
import { setImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { setReconstructionProgressSink } from "./reconstruction_progress.ts";
import { getCachedValueRefreshingRecency, evictLeastRecentlyUsedEntries } from "./cache_lru.ts";
import { readDocumentFromDiskCache, writeDocumentToDiskCache } from "./reconstruction_document_cache.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import {
    reportStage,
    loadProjectRecords,
    computeTranscriptSetStamp,
    ARTIFACT_CACHE_CAPACITY,
} from "./viewer_api_records.ts";

// Stage labels live here so tests compare against constants, never string literals (coding-req §2).
export const PROGRESS_LABEL_READING_SIDECAR = "reading sidecar backups";
export const PROGRESS_LABEL_CONSTRUCTING_BRANCHES = "constructing branches";
export const PROGRESS_LABEL_BUILDING_DOCUMENT = "building document";

// Item 82: emitted before the unsubdividable stringify/transfer so the client doesn't look frozen.
export const PROGRESS_LABEL_SERIALIZING_DOCUMENT = "serializing document";

// byteLength is a numeric measure, not a domain value, so it stays primitive (coding-req §1).
export function formatSendingDocumentLabel(byteLength: number): string {
    return `sending document (${(byteLength / 1_000_000).toFixed(1)} MB)`;
}

// Spec S4a: `sources`, when given, makes the sidecar reader resolve each session's blobs from its OWN source's file-history dir.
export function buildProjectReconstruction(jsonlPaths: Path[], target: Path | undefined, onProgress?: ProgressSink, sources?: SourceEntry[], bound?: RevisionBoundRequest): BuiltReconstruction {
    const loaded = loadProjectRecords(jsonlPaths);
    const { skippedLines } = loaded;
    // Spec S5a: the merge builds a NEW array, so per-records WeakMap memos run cold on multi-source builds.

    // ponytail: memoize per (stamp, sources) if profiling ever shows it.
    const merged = sources === undefined || sources.length === 0
        ? loaded.records
        : mergeMultiSourceRecords(groupRecordsBySession(loaded.records), sources);
    // Task 194: the bound cut must happen BEFORE any engine work, like the CLI's --until-revision.
    const records = bound === undefined
        ? merged
        : truncateRecordsAtRevisionTurnEnd(merged, bound.file, bound.ordinal).records;
    // task 119: a previous build's aborted leftovers must not leak into this document's failures.
    clearReconstructionFailures();
    reportStage(onProgress, PROGRESS_LABEL_READING_SIDECAR);
    const reader = buildSidecarReader(records, sources);
    reportStage(onProgress, PROGRESS_LABEL_CONSTRUCTING_BRANCHES);
    const branched = reconstructBranches(records, reader);
    reportStage(onProgress, PROGRESS_LABEL_BUILDING_DOCUMENT);
    return buildReconstructionDocument(records, branched, reader, target, skippedLines);
}

// The wire document alone — the back-compat surface every non-range-patch caller uses.
export function buildProjectDocument(jsonlPaths: Path[], target: Path | undefined, onProgress?: ProgressSink): ReconstructionDocument {
    return buildProjectReconstruction(jsonlPaths, target, onProgress).document;
}

// Item 68: the read-only verdict uses the conservative classifier — uncertain code counts as may-write.
export type ConsentScript = ScriptRun & { readOnly: boolean };

export type DocumentDecision =
    | { kind: DocumentResponseKind.consentRequired; scripts: ConsentScript[] }
    | { kind: DocumentResponseKind.document };

// The scripts ride along so the consent dialog can show each one's code.
export function decideDocumentResponse(records: TranscriptRecord[], allowScripts: boolean): DocumentDecision {
    const scripts = findScriptExecutionRuns(records);
    if (scripts.length > 0 && !allowScripts) {
        const taggedScripts = scripts.map((run) => ({ ...run, readOnly: !scriptCodeMayWriteFiles(run.code) }));
        return { kind: DocumentResponseKind.consentRequired, scripts: taggedScripts };
    }
    return { kind: DocumentResponseKind.document };
}

// Task 56: asked BEFORE the consent gate — the scope-of-work decision precedes the run-scripts one.
export type BaselineQuestion = {
    kind: DocumentResponseKind.baselineQuestionRequired;
    baseCommit: string;
    repo: string;
};

export function decideBaselineQuestion(choiceMade: boolean): BaselineQuestion | undefined {
    if (choiceMade) {
        return undefined;
    }
    const { repoDir, baseCommit } = getPathOverrides();
    if (repoDir === undefined) {
        return undefined;
    }
    if (baseCommit === undefined) {
        return undefined;
    }
    return {
        kind: DocumentResponseKind.baselineQuestionRequired,
        baseCommit: baseCommit.toString(),
        repo: repoDir.toString(),
    };
}

export const PROGRESS_LABEL_ARTIFACT_CACHE_HIT = "reusing cached document artifact";

// allowScripts is in the key because consented and degraded builds yield different documents.
const builtDocumentCache = new Map<string, BuiltReconstruction>();

// The exec gate runs only for a consented build's synchronous duration; a cache hit returns before that lifecycle starts.
export function buildReconstructionWithConsent(
    jsonlPaths: Path[],
    target: Path | undefined,
    allowScripts: boolean,
    onProgress?: ProgressSink,
    // task 56: trailing + defaulted so every pre-existing caller keeps today's behavior.
    reconstructPreBaseline: boolean = true,
    // task 194: bounded mode — absent means a full build, today's behavior.
    bound?: RevisionBoundRequest,
): BuiltReconstruction {
    const targetKey = target === undefined ? "" : target.toString();
    const boundKey = bound === undefined ? "" : `${bound.file.toString()}#${bound.ordinal}`;
    // Bounded/full and trimmed/full builds never share a cache entry; the stamp reads ACTIVE overrides, so config edits miss the cache.
    const cacheKey = `${computeTranscriptSetStamp(jsonlPaths)}|${allowScripts}|${reconstructPreBaseline}|${targetKey}|${boundKey}|${serializePathOverrides()}`;
    const cachedBuild = getCachedValueRefreshingRecency(builtDocumentCache, cacheKey);
    if (cachedBuild !== undefined) {
        reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
        return cachedBuild;
    }
    // Item 79: after a server respawn the disk cache saves a multi-minute rebuild.
    const diskBuild = readDocumentFromDiskCache(cacheKey);
    if (diskBuild !== undefined) {
        reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
        builtDocumentCache.set(cacheKey, diskBuild);
        evictLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
        return diskBuild;
    }
    setImpureExecutionAllowed(allowScripts);
    setPreBaselineReconstructionAllowed(reconstructPreBaseline);
    setReconstructionProgressSink(onProgress);
    try {
        // Spec S6: sources ride the process-wide overrides, set by the caller before any build.
        const built = buildProjectReconstruction(jsonlPaths, target, onProgress, getPathOverrides().sources, bound);
        // Stamped BEFORE caching — cached copies must carry the flag their cache key promises.
        if (!reconstructPreBaseline && getPathOverrides().baseCommit !== undefined) {
            built.document.preBaselineSkipped = true;
        }
        // Sandbox spawns persist per batch (the O(N²)-write fix); flush the tail before responding.
        flushSandboxMemoToDisk();
        builtDocumentCache.set(cacheKey, built);
        evictLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
        writeDocumentToDiskCache(cacheKey, built);
        return built;
    } finally {
        setImpureExecutionAllowed(false);
        setPreBaselineReconstructionAllowed(true);
        setReconstructionProgressSink(undefined);
    }
}

// The wire document alone — the back-compat surface every non-range-patch caller uses.
export function buildDocumentWithConsent(
    jsonlPaths: Path[],
    target: Path | undefined,
    allowScripts: boolean,
    onProgress?: ProgressSink,
    reconstructPreBaseline: boolean = true,
    bound?: RevisionBoundRequest,
): ReconstructionDocument {
    return buildReconstructionWithConsent(jsonlPaths, target, allowScripts, onProgress, reconstructPreBaseline, bound).document;
}
