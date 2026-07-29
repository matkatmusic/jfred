// Task 301: first root wins, conflicts report, ties silent; explicit temp roots, never live file-history.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { clearReconstructionFailures, drainReconstructionFailures } from "../src/reconstruction_health.ts";
import { resolveBlobAcrossRoots } from "../src/reconstruction_multi_root_blobs.ts";

const SESSION = new Uuid("aaaaaaaa-1111-2222-3333-444444444444");
const BLOB_NAME = new Path("0f3a9c@v1");

function makeRoot(blobContent?: string): Path {
    const root = mkdtempSync(join(tmpdir(), "multi-root-blobs-test-"));
    mkdirSync(join(root, SESSION.toString()), { recursive: true });
    if (blobContent !== undefined) {
        writeFileSync(join(root, SESSION.toString(), BLOB_NAME.toString()), blobContent);
    }
    return new Path(root);
}

beforeEach(() => {
    clearReconstructionFailures();
});

test("test_first_root_wins_on_differing_bytes_and_the_conflict_is_reported", () => {
    const first = makeRoot("alpha bytes\n");
    const second = makeRoot("beta bytes\n");
    const content = resolveBlobAcrossRoots([first, second], SESSION, BLOB_NAME);
    assert.equal(content, "alpha bytes\n");
    const failures = drainReconstructionFailures();
    assert.equal(failures.length, 1);
    assert.match(failures[0]!.reason, /cross-root snapshot conflict/);
    assert.match(failures[0]!.reason, new RegExp(second.toString()));
});

test("test_identical_bytes_in_both_roots_resolve_silently", () => {
    const first = makeRoot("same bytes\n");
    const second = makeRoot("same bytes\n");
    const content = resolveBlobAcrossRoots([first, second], SESSION, BLOB_NAME);
    assert.equal(content, "same bytes\n");
    assert.deepEqual(drainReconstructionFailures(), []);
});

test("test_blob_missing_in_first_root_falls_through_to_second", () => {
    const first = makeRoot();
    const second = makeRoot("beta bytes\n");
    const content = resolveBlobAcrossRoots([first, second], SESSION, BLOB_NAME);
    assert.equal(content, "beta bytes\n");
    assert.deepEqual(drainReconstructionFailures(), []);
});
