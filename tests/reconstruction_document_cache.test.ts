// Item 79: the document cache round-trips a BuiltReconstruction through JSON with real domain objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { computeFilesAtStep } from "../src/reconstruction_steps.ts";
import {
    encodeBuild,
    parseBuild,
    setDocumentCachePersistence,
    readDocumentFromDiskCache,
    writeDocumentToDiskCache,
    DOCUMENT_CACHE_CAPACITY,
} from "../src/reconstruction_document_cache.ts";
import { Path } from "../src/structures/domain.ts";
import { S1_JSONL } from "./fixtures.ts";

// The last step's resolved { path: content } map for a built reconstruction.
function filesAtLastStep(built: { document: { steps: { when: Date }[] }; stepFileHistories: Parameters<typeof computeFilesAtStep>[0] }): Record<string, string> {
    const lastStep = built.document.steps[built.document.steps.length - 1]!;
    return computeFilesAtStep(built.stepFileHistories, lastStep.when);
}

test("test_hydrated_build_roundtrip_preserves_domain_object_types", () => {
    // Scenario: a hydrated build holds real Path and Date objects and loses nothing.
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    const hydrated = parseBuild(encodeBuild(fresh));
    assert.ok(hydrated !== undefined);
    assert.ok(hydrated.document.filesTouched[0]!.target instanceof Path);
    assert.ok(hydrated.document.steps[0]!.when instanceof Date);
    assert.equal(encodeBuild(hydrated), encodeBuild(fresh));
});

test("test_hydrated_build_drives_identical_step_file_resolution", () => {
    // Hydrated histories resolve a step's files identically to the fresh build.
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    const freshFiles = filesAtLastStep(fresh);
    const hydrated = parseBuild(encodeBuild(fresh))!;
    const hydratedFiles = filesAtLastStep(hydrated);
    assert.deepEqual(hydratedFiles, freshFiles);
});

test("test_written_build_reads_back_hydrated_from_disk", () => {
    // Scenario: a build written under a configured directory reads back, hydrated, for the same key.
    setDocumentCachePersistence(new Path(mkdtempSync(join(tmpdir(), "doccache-"))));
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    writeDocumentToDiskCache("key-a", fresh);
    const fromDisk = readDocumentFromDiskCache("key-a");
    assert.ok(fromDisk !== undefined);
    assert.deepEqual(filesAtLastStep(fromDisk), filesAtLastStep(fresh));
    setDocumentCachePersistence(undefined);
});

test("test_disk_cache_read_is_a_miss_when_persistence_is_unconfigured", () => {
    // Scenario: with no directory configured (the CLI/test default), reads are silent misses.
    setDocumentCachePersistence(undefined);
    assert.equal(readDocumentFromDiskCache("anything"), undefined);
});

test("test_disk_cache_is_capped_at_capacity", () => {
    // Writing more keys than capacity leaves exactly capacity files; eviction order is unstable.
    const directory = mkdtempSync(join(tmpdir(), "doccache-evict-"));
    setDocumentCachePersistence(new Path(directory));
    const built = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    for (let index = 0; index < DOCUMENT_CACHE_CAPACITY + 1; index += 1) {
        writeDocumentToDiskCache(`evict-key-${index}`, built);
    }
    const remaining = readdirSync(directory).filter((name) => name.endsWith(".json"));
    assert.equal(remaining.length, DOCUMENT_CACHE_CAPACITY);
    setDocumentCachePersistence(undefined);
});

