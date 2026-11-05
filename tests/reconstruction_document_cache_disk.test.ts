// The persisted document cache keeps at most DOCUMENT_CACHE_CAPACITY files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { setDocumentCachePersistence, writeDocumentToDiskCache } from "../src/reconstruction_document_cache.ts";
import { DOCUMENT_CACHE_CAPACITY } from "../src/reconstruction_document_cache_disk.ts";
import { Path } from "../src/structures/domain.ts";
import { S1_JSONL } from "./fixtures.ts";

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
