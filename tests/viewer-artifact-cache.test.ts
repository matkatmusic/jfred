// Identity assertions (assert.equal on objects) are the point here: same object === no re-work done.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildProjectDocument,
    buildDocumentWithConsent,
    PROGRESS_LABEL_ARTIFACT_CACHE_HIT,
} from "../src/viewer_api.ts";
import {
    computeTranscriptSetStamp,
    loadProjectRecords,
    ARTIFACT_CACHE_CAPACITY,
    PROGRESS_LABEL_RECORDS_CACHE_HIT,
} from "../src/viewer_api_records.ts";
import {
    renderRevisionDiff,
    renderDiffVsBase,
} from "../src/viewer_api_diffs.ts";
import { Path } from "../src/structures/domain.ts";
import { copyFixtureIntoTempDir, advanceFileMtimeByOneSecond } from "./utilities.ts";
import { S1_JSONL, S19_JSONL, S37_JSONL, S85_JSONL_PATHS } from "./fixtures.ts";

test("test_transcript_set_stamp_is_stable_for_unchanged_files", () => {
    const firstStamp = computeTranscriptSetStamp(S85_JSONL_PATHS);
    const secondStamp = computeTranscriptSetStamp(S85_JSONL_PATHS);
    assert.equal(firstStamp, secondStamp);
});

test("test_transcript_set_stamp_ignores_path_order", () => {
    // Safe because production callers always pass resolveJsonlPaths' mtime-sorted order, so a cache
    // hit's record order matches what a fresh parse of that same call would produce.
    const forwardStamp = computeTranscriptSetStamp([new Path(S1_JSONL), new Path(S19_JSONL)]);
    const reversedStamp = computeTranscriptSetStamp([new Path(S19_JSONL), new Path(S1_JSONL)]);
    assert.equal(forwardStamp, reversedStamp);
});

test("test_transcript_set_stamp_changes_when_a_file_is_touched", () => {
    // A changed mtime is the whole invalidation signal.
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const beforeStamp = computeTranscriptSetStamp([copyPath]);
    advanceFileMtimeByOneSecond(copyPath);
    const afterStamp = computeTranscriptSetStamp([copyPath]);
    assert.notEqual(afterStamp, beforeStamp);
});

test("test_load_project_records_returns_same_array_for_unchanged_files", () => {
    // Same array object also keeps the engine's per-records WeakMap memos warm across requests.
    const firstRecords = loadProjectRecords(S85_JSONL_PATHS).records;
    const secondRecords = loadProjectRecords(S85_JSONL_PATHS).records;
    assert.equal(secondRecords, firstRecords);
});

test("test_load_project_records_reparses_after_file_touch", () => {
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const staleRecords = loadProjectRecords([copyPath]).records;
    advanceFileMtimeByOneSecond(copyPath);
    const freshRecords = loadProjectRecords([copyPath]).records;
    assert.notEqual(freshRecords, staleRecords);
});

test("test_load_project_records_reports_cache_hit_label", () => {
    // The hit label is how the loading console explains why no per-record parse lines appeared.
    loadProjectRecords([new Path(S19_JSONL)]);
    const collectedLabels: string[] = [];
    loadProjectRecords([new Path(S19_JSONL)], (event) => collectedLabels.push(event.label));
    assert.ok(collectedLabels.includes(PROGRESS_LABEL_RECORDS_CACHE_HIT));
});

test("test_build_with_consent_returns_same_document_for_unchanged_files", () => {
    const firstDocument = buildDocumentWithConsent(S85_JSONL_PATHS, undefined, false);
    const secondDocument = buildDocumentWithConsent(S85_JSONL_PATHS, undefined, false);
    assert.equal(secondDocument, firstDocument);
});

test("test_build_with_consent_keeps_consent_variants_in_separate_entries", () => {
    // A consented build must never be served the degraded artifact: on S37 the two differ by
    // script-derived revisions, so the consent flag has to be part of the cache key.
    const degradedDocument = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, false);
    const consentedDocument = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, true);
    assert.notEqual(consentedDocument, degradedDocument);
});

test("test_build_with_consent_rebuilds_after_file_touch", () => {
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const staleDocument = buildDocumentWithConsent([copyPath], undefined, false);
    advanceFileMtimeByOneSecond(copyPath);
    const freshDocument = buildDocumentWithConsent([copyPath], undefined, false);
    assert.notEqual(freshDocument, staleDocument);
});

test("test_build_with_consent_reports_artifact_cache_hit_label", () => {
    buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false);
    const collectedLabels: string[] = [];
    buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false, (event) => collectedLabels.push(event.label));
    assert.ok(collectedLabels.includes(PROGRESS_LABEL_ARTIFACT_CACHE_HIT));
});

test("test_document_cache_evicts_least_recently_used_entry_beyond_capacity", () => {
    // Distinct by target, which is part of the key; a target no revision matches still builds.
    const buildForTarget = (targetIndex: number) =>
        buildDocumentWithConsent([new Path(S1_JSONL)], new Path(`/evict/probe-${targetIndex}.txt`), false);
    const firstDocument = buildForTarget(0);
    let lastDocument = firstDocument;
    for (let targetIndex = 1; targetIndex <= ARTIFACT_CACHE_CAPACITY; targetIndex += 1) {
        lastDocument = buildForTarget(targetIndex);
    }
    assert.equal(buildForTarget(ARTIFACT_CACHE_CAPACITY), lastDocument);
    assert.notEqual(buildForTarget(0), firstDocument);
});

test("test_document_cache_read_refreshes_recency", () => {
    // LRU, not FIFO: the project-wide artifact must survive per-conversation builds while it is read.
    const buildForTarget = (targetIndex: number) =>
        buildDocumentWithConsent([new Path(S1_JSONL)], new Path(`/lru/probe-${targetIndex}.txt`), false);
    const protectedDocument = buildForTarget(0);
    for (let targetIndex = 1; targetIndex < ARTIFACT_CACHE_CAPACITY; targetIndex += 1) {
        buildForTarget(targetIndex);
    }
    assert.equal(buildForTarget(0), protectedDocument);
    buildForTarget(ARTIFACT_CACHE_CAPACITY);
    assert.equal(buildForTarget(0), protectedDocument);
});

test("test_records_cache_evicts_least_recently_used_entry_beyond_capacity", () => {
    // The records cache is bounded by the same capacity and helpers as the document cache.
    const firstCopy = copyFixtureIntoTempDir(S1_JSONL);
    const firstRecords = loadProjectRecords([firstCopy]).records;
    for (let extraIndex = 0; extraIndex < ARTIFACT_CACHE_CAPACITY; extraIndex += 1) {
        loadProjectRecords([copyFixtureIntoTempDir(S1_JSONL)]);
    }
    assert.notEqual(loadProjectRecords([firstCopy]).records, firstRecords);
});

test("test_revision_diff_from_untargeted_document_matches_targeted_build", () => {
    // Targeting only filters snapshots/histories, so /api/diff may serve from the shared
    // untargeted artifact.
    const untargetedDocument = buildProjectDocument(S85_JSONL_PATHS, undefined);
    const trackedFile = untargetedDocument.filesTouched[0]!.target;
    const targetedDocument = buildProjectDocument(S85_JSONL_PATHS, trackedFile);
    assert.equal(renderRevisionDiff(untargetedDocument, trackedFile), renderRevisionDiff(targetedDocument, trackedFile));
    assert.equal(renderDiffVsBase(untargetedDocument, trackedFile, 0), renderDiffVsBase(targetedDocument, trackedFile, 0));
});

