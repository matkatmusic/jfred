// Builds documents, decides script consent, and caches results. HTTP wiring lives in sibling viewer_api_*.ts files.

import type { ProgressSink } from "./parse/loadTranscript.ts";
import {
  buildReconstructionDocument,
  type ReconstructionDocument,
  type BuiltReconstruction,
} from "./reconstruction_json.ts";
import { buildBranchedReconstruction } from "./reconstruction_engine.ts";
import { clearReconstructionFailures } from "./reconstruction_health.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { getPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import type { RevisionBoundRequest } from "./reconstruction_bound.ts";
import { writePendingSandboxMemoToDisk } from "./reconstruction_script_sandbox_memo.ts";
import {
  selectBuildRecords,
  computeBuildCacheKey,
  applyBuildGates,
  resetBuildGates,
  markPreBaselineSkipped,
} from "./viewer_api_build_support.ts";
import { getCachedValueRefreshingRecency, removeLeastRecentlyUsedEntries } from "./cache_lru.ts";
import { readDocumentFromDiskCache, writeDocumentToDiskCache } from "./reconstruction_document_cache.ts";
import type { Path } from "./structures/domain.ts";
import {
  reportStage,
  loadProjectRecords,
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
  const records = selectBuildRecords(loaded.records, sources, bound);
  // task 119: a previous build's aborted leftovers must not leak into this document's failures.
  clearReconstructionFailures();
  reportStage(onProgress, PROGRESS_LABEL_READING_SIDECAR);
  const reader = buildSidecarReader(records, sources);
  reportStage(onProgress, PROGRESS_LABEL_CONSTRUCTING_BRANCHES);
  const branched = buildBranchedReconstruction(records, reader);
  reportStage(onProgress, PROGRESS_LABEL_BUILDING_DOCUMENT);
  return buildReconstructionDocument(records, branched, reader, target, skippedLines);
}

// The wire document alone — the back-compat surface every non-range-patch caller uses.
export function buildProjectDocument(jsonlPaths: Path[], target: Path | undefined, onProgress?: ProgressSink): ReconstructionDocument {
  return buildProjectReconstruction(jsonlPaths, target, onProgress).document;
}

export const PROGRESS_LABEL_ARTIFACT_CACHE_HIT = "reusing cached document artifact";

// allowScripts is in the key because consented and degraded builds yield different documents.
const builtDocumentCache = new Map<string, BuiltReconstruction>();

export function clearBuiltDocumentCache(): void {
  builtDocumentCache.clear();
}

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
  const cacheKey = computeBuildCacheKey(jsonlPaths, target, allowScripts, reconstructPreBaseline, bound);
  const cachedBuild = readCachedBuild(cacheKey, onProgress);
  if (cachedBuild !== undefined) {
    return cachedBuild;
  }
  return executeConsentedBuild(cacheKey, jsonlPaths, target, allowScripts, onProgress, reconstructPreBaseline, bound);
}

// Memory first, then the disk cache (item 79: after a server respawn it saves a multi-minute rebuild).
function readCachedBuild(cacheKey: string, onProgress?: ProgressSink): BuiltReconstruction | undefined {
  const memoryBuild = getCachedValueRefreshingRecency(builtDocumentCache, cacheKey);
  if (memoryBuild !== undefined) {
    reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
    return memoryBuild;
  }
  const diskBuild = readDocumentFromDiskCache(cacheKey);
  if (diskBuild !== undefined) {
    reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
    builtDocumentCache.set(cacheKey, diskBuild);
    removeLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
  }
  return diskBuild;
}

// Sandbox spawns persist per batch (the O(N²)-write fix); flush the tail before responding.
function storeBuiltDocument(cacheKey: string, built: BuiltReconstruction): void {
  writePendingSandboxMemoToDisk();
  builtDocumentCache.set(cacheKey, built);
  removeLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
  writeDocumentToDiskCache(cacheKey, built);
}

function executeConsentedBuild(cacheKey: string, jsonlPaths: Path[], target: Path | undefined, allowScripts: boolean, onProgress: ProgressSink | undefined, reconstructPreBaseline: boolean, bound?: RevisionBoundRequest): BuiltReconstruction {
  applyBuildGates(allowScripts, reconstructPreBaseline, onProgress);
  try {
    // Spec S6: sources ride the process-wide overrides, set by the caller before any build.
    const built = buildProjectReconstruction(jsonlPaths, target, onProgress, getPathOverrides().sources, bound);
    markPreBaselineSkipped(built, reconstructPreBaseline);
    storeBuiltDocument(cacheKey, built);
    return built;
  }
  finally {
    resetBuildGates();
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
