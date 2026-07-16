// Tests for the viewer's server-side artifact caches (src/viewer_api.ts): the transcript-set
// freshness stamp, the parsed-records cache, the built-document cache, and their LRU bound.
// Identity assertions (assert.equal on objects) are the point: same object === no re-work done.

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
    // Scenario: stamping the same untouched fixture set twice yields the identical string.
    // Steps:
    // stamp the s85 fixture set once.
    const firstStamp = computeTranscriptSetStamp(S85_JSONL_PATHS);
    // stamp it again with nothing changed on disk.
    const secondStamp = computeTranscriptSetStamp(S85_JSONL_PATHS);
    // the two stamps agree exactly.
    assert.equal(firstStamp, secondStamp);
});

test("test_transcript_set_stamp_ignores_path_order", () => {
    // Scenario: the stamp identifies a SET — reversing the path list must not change it.
    // (Production callers always pass resolveJsonlPaths' mtime-sorted order, so the cached
    // array's record order always matches what a fresh parse of that same call would produce.)
    // Steps:
    // stamp a two-file set in one order.
    const forwardStamp = computeTranscriptSetStamp([new Path(S1_JSONL), new Path(S19_JSONL)]);
    // stamp the identical set reversed.
    const reversedStamp = computeTranscriptSetStamp([new Path(S19_JSONL), new Path(S1_JSONL)]);
    // both orders yield one stamp.
    assert.equal(forwardStamp, reversedStamp);
});

test("test_transcript_set_stamp_changes_when_a_file_is_touched", () => {
    // Scenario: bumping one file's mtime yields a different stamp — the invalidation signal.
    // Steps:
    // copy a fixture into a private temp dir and stamp it.
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const beforeStamp = computeTranscriptSetStamp([copyPath]);
    // push the copy's mtime forward.
    advanceFileMtimeByOneSecond(copyPath);
    // the stamp after the touch differs from the stamp before.
    const afterStamp = computeTranscriptSetStamp([copyPath]);
    assert.notEqual(afterStamp, beforeStamp);
});

test("test_load_project_records_returns_same_array_for_unchanged_files", () => {
    // Scenario: two loads of an unchanged set return the SAME array object — proof the second
    // call parsed nothing (and the engine's per-records WeakMap memos stay warm across requests).
    // Steps:
    // load the s85 set once (parse) and again (must be a cache hit).
    const firstRecords = loadProjectRecords(S85_JSONL_PATHS);
    const secondRecords = loadProjectRecords(S85_JSONL_PATHS);
    // same object, not merely equal content.
    assert.equal(secondRecords, firstRecords);
});

test("test_load_project_records_reparses_after_file_touch", () => {
    // Scenario: after a file's mtime changes, the next load re-parses into a fresh array.
    // Steps:
    // load a private temp copy once.
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const staleRecords = loadProjectRecords([copyPath]);
    // touch the copy.
    advanceFileMtimeByOneSecond(copyPath);
    // the reload returns a NEW array, not the stale cached one.
    const freshRecords = loadProjectRecords([copyPath]);
    assert.notEqual(freshRecords, staleRecords);
});

test("test_load_project_records_reports_cache_hit_label", () => {
    // Scenario: a records-cache hit announces itself so the loading console can say WHY no
    // per-record parse lines appeared.
    // Steps:
    // prime the cache.
    loadProjectRecords([new Path(S19_JSONL)]);
    // reload with a collecting sink.
    const collectedLabels: string[] = [];
    loadProjectRecords([new Path(S19_JSONL)], (event) => collectedLabels.push(event.label));
    // the exported hit constant was announced.
    assert.ok(collectedLabels.includes(PROGRESS_LABEL_RECORDS_CACHE_HIT));
});

test("test_build_with_consent_returns_same_document_for_unchanged_files", () => {
    // Scenario: two identical declined builds return the SAME document object — the second
    // request did no engine work.
    const firstDocument = buildDocumentWithConsent(S85_JSONL_PATHS, undefined, false);
    const secondDocument = buildDocumentWithConsent(S85_JSONL_PATHS, undefined, false);
    assert.equal(secondDocument, firstDocument);
});

test("test_build_with_consent_keeps_consent_variants_in_separate_entries", () => {
    // Scenario: a consented build must never be handed the degraded artifact — on the
    // recorded-script scenario the two differ by script-derived revisions. Same consent
    // pattern tests/viewer-api.test.ts:178,199 already runs on S37.
    // Steps:
    // build declined (degraded), then consented.
    const degradedDocument = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, false);
    const consentedDocument = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, true);
    // distinct objects — the consent flag is part of the cache key.
    assert.notEqual(consentedDocument, degradedDocument);
});

test("test_build_with_consent_rebuilds_after_file_touch", () => {
    // Scenario: a file touch invalidates the document entry exactly like the records entry.
    // Steps:
    // build over a private temp copy.
    const copyPath = copyFixtureIntoTempDir(S1_JSONL);
    const staleDocument = buildDocumentWithConsent([copyPath], undefined, false);
    // touch, rebuild.
    advanceFileMtimeByOneSecond(copyPath);
    const freshDocument = buildDocumentWithConsent([copyPath], undefined, false);
    // a NEW document, not the stale one.
    assert.notEqual(freshDocument, staleDocument);
});

test("test_build_with_consent_reports_artifact_cache_hit_label", () => {
    // Scenario: an artifact-cache hit announces itself on the progress stream.
    // Steps:
    // prime the cache.
    buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false);
    // rebuild with a collecting sink.
    const collectedLabels: string[] = [];
    buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false, (event) => collectedLabels.push(event.label));
    // the exported hit constant was announced.
    assert.ok(collectedLabels.includes(PROGRESS_LABEL_ARTIFACT_CACHE_HIT));
});

test("test_document_cache_evicts_least_recently_used_entry_beyond_capacity", () => {
    // Scenario: with capacity K, K+1 distinct artifacts evict the least-recently-used;
    // rebuilding it yields a NEW object while the newest is still served from cache.
    // Steps:
    // build K+1 documents over one tiny fixture, distinct by target (target is a key part;
    // a target no revision matches still builds — it just filters everything out).
    const buildForTarget = (targetIndex: number) =>
        buildDocumentWithConsent([new Path(S1_JSONL)], new Path(`/evict/probe-${targetIndex}.txt`), false);
    const firstDocument = buildForTarget(0);
    let lastDocument = firstDocument;
    for (let targetIndex = 1; targetIndex <= ARTIFACT_CACHE_CAPACITY; targetIndex += 1) {
        lastDocument = buildForTarget(targetIndex);
    }
    // the newest build is still cached.
    assert.equal(buildForTarget(ARTIFACT_CACHE_CAPACITY), lastDocument);
    // the first was evicted — its rebuild is a fresh object.
    assert.notEqual(buildForTarget(0), firstDocument);
});

test("test_document_cache_read_refreshes_recency", () => {
    // Scenario: reading an entry protects it from the next eviction (LRU, not FIFO) — the
    // project-wide artifact must survive per-conversation builds as long as it keeps being read.
    // Steps:
    // fill the cache to exactly capacity, entry 0 first.
    const buildForTarget = (targetIndex: number) =>
        buildDocumentWithConsent([new Path(S1_JSONL)], new Path(`/lru/probe-${targetIndex}.txt`), false);
    const protectedDocument = buildForTarget(0);
    for (let targetIndex = 1; targetIndex < ARTIFACT_CACHE_CAPACITY; targetIndex += 1) {
        buildForTarget(targetIndex);
    }
    // read entry 0 — this must refresh its recency.
    assert.equal(buildForTarget(0), protectedDocument);
    // one insert past capacity now evicts entry 1, NOT entry 0.
    buildForTarget(ARTIFACT_CACHE_CAPACITY);
    assert.equal(buildForTarget(0), protectedDocument);
});

test("test_records_cache_evicts_least_recently_used_entry_beyond_capacity", () => {
    // Scenario: the records cache is bounded by the same capacity and helpers.
    // Steps:
    // prime with one temp copy, then load CAPACITY more distinct sets to push it out.
    const firstCopy = copyFixtureIntoTempDir(S1_JSONL);
    const firstRecords = loadProjectRecords([firstCopy]);
    for (let extraIndex = 0; extraIndex < ARTIFACT_CACHE_CAPACITY; extraIndex += 1) {
        loadProjectRecords([copyFixtureIntoTempDir(S1_JSONL)]);
    }
    // the evicted set re-parses into a fresh array.
    assert.notEqual(loadProjectRecords([firstCopy]), firstRecords);
});

test("test_revision_diff_from_untargeted_document_matches_targeted_build", () => {
    // Scenario: targeting only filters snapshots/histories — a file's own revision sequence is
    // identical either way, so /api/diff can serve from the shared untargeted artifact.
    // Steps:
    // pick a real tracked file from the untargeted s85 document.
    const untargetedDocument = buildProjectDocument(S85_JSONL_PATHS, undefined);
    const trackedFile = untargetedDocument.filesTouched[0]!.target;
    // build the old-style targeted document for that file.
    const targetedDocument = buildProjectDocument(S85_JSONL_PATHS, trackedFile);
    // both documents render the identical revision-timeline diff text...
    assert.equal(renderRevisionDiff(untargetedDocument, trackedFile), renderRevisionDiff(targetedDocument, trackedFile));
    // ...and the identical vs-base diff at revision 0.
    assert.equal(renderDiffVsBase(untargetedDocument, trackedFile, 0), renderDiffVsBase(targetedDocument, trackedFile, 0));
});

