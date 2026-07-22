// The viewer server's document-build layer: build ReconstructionDocuments over one-or-many
// JSONLs, decide when script-execution consent is needed, and cache built documents. Pure
// functions over the existing engine — the HTTP wiring lives in viewer_server.ts; project
// scanning, record loading, and diff rendering live in viewer_api_projects.ts,
// viewer_api_records.ts, and viewer_api_diffs.ts.

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
import { setPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";
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

// The build's post-parse stage announcements, in the order buildProjectDocument runs them. Tests
// compare against these constants, never string literals (coding-req §2 — one vocabulary home).
export const PROGRESS_LABEL_READING_SIDECAR = "reading sidecar backups";
export const PROGRESS_LABEL_CONSTRUCTING_BRANCHES = "constructing branches";
export const PROGRESS_LABEL_BUILDING_DOCUMENT = "building document";

// Emitted right BEFORE the two synchronous blocking steps the build's progress sink can't see
// into: JSON.stringify of the whole document (server) and its transfer. A single
// stringify/transfer can't be subdivided, so an honest label before each is what keeps the
// client from freezing on the previous line (item 82 — the 67 MB document is seconds of
// silent stringify + a browser-side parse of the same size).
export const PROGRESS_LABEL_SERIALIZING_DOCUMENT = "serializing document";

// byteLength is a genuine numeric measure, not a domain value, so it stays primitive (coding-req §1).
export function formatSendingDocumentLabel(byteLength: number): string {
    return `sending document (${(byteLength / 1_000_000).toFixed(1)} MB)`;
}

// One-or-many JSONLs -> the wire document AND its compact step-file histories (returned separately;
// the histories never ride the wire). Exactly the CLI --json composition, generalized to a merged
// multi-JSONL record stream (the coverage checker's proven pattern). The optional `sources` list
// (spec S4a) makes the sidecar reader resolve each session's blobs from its OWN source's
// file-history dir — absent, the single-root chain applies exactly as before.
export function buildProjectReconstruction(jsonlPaths: Path[], target: Path | undefined, onProgress?: ProgressSink, sources?: SourceEntry[]): BuiltReconstruction {
    // The per-record walk belongs to the caller's own loadProjectRecords call (the /api/document
    // route always pre-walks); the build emits stages and deep-engine progress only.
    // skippedLines rides to the wire document (the webapp's partial-reconstruction gaps).
    const { records, skippedLines } = loadProjectRecords(jsonlPaths);
    // task 119: a previous build's aborted leftovers must not leak into this document's failures.
    clearReconstructionFailures();
    reportStage(onProgress, PROGRESS_LABEL_READING_SIDECAR);
    const reader = buildSidecarReader(records, sources);
    reportStage(onProgress, PROGRESS_LABEL_CONSTRUCTING_BRANCHES);
    const branched = reconstructBranches(records, reader);
    reportStage(onProgress, PROGRESS_LABEL_BUILDING_DOCUMENT);
    return buildReconstructionDocument(records, branched, reader, target, skippedLines);
}

// The wire document alone — the back-compat surface every non-range-patch caller uses (the histories
// are an implementation detail only the range-patch / step-files routes need).
export function buildProjectDocument(jsonlPaths: Path[], target: Path | undefined, onProgress?: ProgressSink): ReconstructionDocument {
    return buildProjectReconstruction(jsonlPaths, target, onProgress).document;
}

// One recorded script run plus the consent dialog's read-only verdict: the same conservative
// classifier execution uses (item 68) — uncertain code counts as may-write, i.e. Modifying.
export type ConsentScript = ScriptRun & { readOnly: boolean };

export type DocumentDecision =
    | { kind: DocumentResponseKind.consentRequired; scripts: ConsentScript[] }
    | { kind: DocumentResponseKind.document };

// Decide whether a document build must first ask the user to consent to running the transcript's
// scripts: consent is required only when script runs exist AND consent wasn't given. The scripts
// ride along so the client can show each one's code in the consent dialog.
export function decideDocumentResponse(records: TranscriptRecord[], allowScripts: boolean): DocumentDecision {
    const scripts = findScriptExecutionRuns(records);
    if (scripts.length > 0 && !allowScripts) {
        // The dialog marks read-only scripts; the flag rides the wire with each script (item 69).
        const taggedScripts = scripts.map((run) => ({ ...run, readOnly: !scriptCodeMayWriteFiles(run.code) }));
        return { kind: DocumentResponseKind.consentRequired, scripts: taggedScripts };
    }
    return { kind: DocumentResponseKind.document };
}

// Task 56: the pre-baseline question payload for the wire, or undefined when the gate does
// not apply. It applies only when the ACTIVE project overrides carry a base commit (item 46)
// and the client has not yet sent a preBaseline choice — asked BEFORE the consent gate (the
// scope-of-work decision precedes the run-scripts decision, and it needs no record scan).
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

// Built documents per (transcript-set stamp, consent, target). allowScripts is in the key
// because consented and degraded builds yield different documents and must never share an
// entry. target is in the key only to keep the /api/document?target= contract intact — the
// webapp never sends it, so in practice this holds one entry per (project, consent).
const builtDocumentCache = new Map<string, BuiltReconstruction>();

// Build a document under the consent decision: the exec gate is on only for a consented build's
// own (synchronous) duration, and always off afterwards — the server's resting posture. A declined
// build still yields a document, just degraded (no script-derived revisions). A cache hit returns
// before the gate/sink lifecycle: nothing impure runs when no build runs.
// Build (or reuse) the document AND its step-file histories under the consent decision. The cached
// value carries both, so range-patch / step-files requests reuse the compact histories instead of
// re-reconstructing (the histories are never serialized onto the wire).
export function buildReconstructionWithConsent(
    jsonlPaths: Path[],
    target: Path | undefined,
    allowScripts: boolean,
    onProgress?: ProgressSink,
    // task 56: trailing + defaulted so every pre-existing caller keeps today's behavior.
    reconstructPreBaseline: boolean = true,
): BuiltReconstruction {
    const targetKey = target === undefined ? "" : target.toString();
    // item 46: const cacheKey = `${computeTranscriptSetStamp(jsonlPaths)}|${allowScripts}|${targetKey}`;
    // The stamp reads the ACTIVE overrides — callers applyProjectOverrides first; a config-file
    // edit between requests changes the stamp and misses the cache, which is the point.
    // task 56: the pre-baseline choice is in the key — a trimmed and a full build must never
    // share an entry (same reason allowScripts is here).
    const cacheKey = `${computeTranscriptSetStamp(jsonlPaths)}|${allowScripts}|${reconstructPreBaseline}|${targetKey}|${serializePathOverrides()}`;
    const cachedBuild = getCachedValueRefreshingRecency(builtDocumentCache, cacheKey);
    if (cachedBuild !== undefined) {
        reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
        return cachedBuild;
    }
    // item 79: an in-memory miss may still hit the disk cache after a server respawn — hydrate it,
    // repopulate the in-memory cache, and skip the multi-minute rebuild. No-op when the CLI/tests
    // leave the disk cache unconfigured.
    const diskBuild = readDocumentFromDiskCache(cacheKey);
    if (diskBuild !== undefined) {
        reportStage(onProgress, PROGRESS_LABEL_ARTIFACT_CACHE_HIT);
        builtDocumentCache.set(cacheKey, diskBuild);
        evictLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
        return diskBuild;
    }
    setImpureExecutionAllowed(allowScripts);
    // task 56: same lifecycle as the exec gate — the trim is on only for this build's duration.
    setPreBaselineReconstructionAllowed(reconstructPreBaseline);
    // The deep engine stages (script sandbox runs, per-file reconstruction) announce through the
    // build-scoped module sink — same lifecycle as the exec gate: on for the build, off after.
    setReconstructionProgressSink(onProgress);
    try {
        const built = buildProjectReconstruction(jsonlPaths, target, onProgress);
        // task 56: stamp trimmed builds so the timeline knows to start at the baseline node.
        // Stamped BEFORE caching — cached copies must carry the flag their cache key promises.
        if (!reconstructPreBaseline && getPathOverrides().baseCommit !== undefined) {
            built.document.preBaselineSkipped = true;
        }
        // The build's new sandbox spawns were persisted per batch; flush the final tail so nothing is
        // lost before the response (batched persist is the O(N²)-write fix — item Step 6).
        flushSandboxMemoToDisk();
        builtDocumentCache.set(cacheKey, built);
        evictLeastRecentlyUsedEntries(builtDocumentCache, ARTIFACT_CACHE_CAPACITY);
        // item 79: persist to disk so a server respawn reads this back (hydrated) instead of rebuilding.
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
): ReconstructionDocument {
    return buildReconstructionWithConsent(jsonlPaths, target, allowScripts, onProgress, reconstructPreBaseline).document;
}
