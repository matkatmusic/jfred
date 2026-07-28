// Item 79: the disk-backed builtDocumentCache round-trips a BuiltReconstruction through JSON while
// rebuilding real Path/Uuid/Date domain objects. The gate is behavioral: a hydrated build must drive
// step-file resolution byte-identically to a fresh build — a plain JSON.parse corrupts that path
// (step.when would be a string and resolveFilesAtStep calls Date methods on it).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { resolveFilesAtStep } from "../src/reconstruction_steps.ts";
import {
    serializeBuild,
    hydrateBuild,
    configureDocumentCachePersistence,
    readDocumentFromDiskCache,
    writeDocumentToDiskCache,
    DOCUMENT_CACHE_CAPACITY,
} from "../src/reconstruction_document_cache.ts";
import { Path } from "../src/structures/domain.ts";
import { S1_JSONL } from "./fixtures.ts";

// The last step's resolved { path: content } map for a built reconstruction.
function filesAtLastStep(built: { document: { steps: { when: Date }[] }; stepFileHistories: Parameters<typeof resolveFilesAtStep>[0] }): Record<string, string> {
    const lastStep = built.document.steps[built.document.steps.length - 1]!;
    return resolveFilesAtStep(built.stepFileHistories, lastStep.when);
}

test("test_hydrated_build_roundtrip_preserves_domain_object_types", () => {
    // Scenario: a serialized-then-hydrated BuiltReconstruction rebuilds real Path/Date domain objects,
    //           not the bare strings JSON.stringify would leave — and loses nothing.
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    const hydrated = hydrateBuild(serializeBuild(fresh));
    assert.ok(hydrated !== undefined);
    assert.ok(hydrated.document.filesTouched[0]!.target instanceof Path);
    assert.ok(hydrated.document.steps[0]!.when instanceof Date);
    assert.equal(serializeBuild(hydrated), serializeBuild(fresh));
});

test("test_hydrated_build_drives_identical_step_file_resolution", () => {
    // Scenario: the hydrated histories resolve a step's files byte-identically to the fresh build.
    //           This is the real regression gate — a plain JSON.parse corrupts this path.
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    const freshFiles = filesAtLastStep(fresh);
    const hydrated = hydrateBuild(serializeBuild(fresh))!;
    const hydratedFiles = filesAtLastStep(hydrated);
    assert.deepEqual(hydratedFiles, freshFiles);
});

test("test_written_build_reads_back_hydrated_from_disk", () => {
    // Scenario: a build written under a configured directory reads back, hydrated, for the same key.
    configureDocumentCachePersistence(new Path(mkdtempSync(join(tmpdir(), "doccache-"))));
    const fresh = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    writeDocumentToDiskCache("key-a", fresh);
    const fromDisk = readDocumentFromDiskCache("key-a");
    assert.ok(fromDisk !== undefined);
    assert.deepEqual(filesAtLastStep(fromDisk), filesAtLastStep(fresh));
    configureDocumentCachePersistence(undefined);
});

test("test_disk_cache_read_is_a_miss_when_persistence_is_unconfigured", () => {
    // Scenario: with no directory configured (the CLI/test default), reads are silent misses.
    configureDocumentCachePersistence(undefined);
    assert.equal(readDocumentFromDiskCache("anything"), undefined);
});

test("test_disk_cache_is_capped_at_capacity", () => {
    // Scenario: writing more distinct keys than the capacity leaves exactly the capacity of files on
    //           disk — eviction fires. (Asserts the COUNT, not which file: rapid same-content writes
    //           can tie on mtime, so which one is evicted is not a stable contract.)
    const directory = mkdtempSync(join(tmpdir(), "doccache-evict-"));
    configureDocumentCachePersistence(new Path(directory));
    const built = buildProjectReconstruction([new Path(S1_JSONL)], undefined);
    for (let index = 0; index < DOCUMENT_CACHE_CAPACITY + 1; index += 1) {
        writeDocumentToDiskCache(`evict-key-${index}`, built);
    }
    const remaining = readdirSync(directory).filter((name) => name.endsWith(".json"));
    assert.equal(remaining.length, DOCUMENT_CACHE_CAPACITY);
    configureDocumentCachePersistence(undefined);
});

