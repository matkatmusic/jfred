// The sidecar reader fixtures build the trees and blobs the reader tests expect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCopiedTree, loadMinimalTranscript, writeBlobForSession } from "./sidecar-reader-test-helpers.ts";

test("test_create_copied_tree_adds_file_history_sibling_only_when_asked", () => {
    const withSibling = createCopiedTree(true);
    const withoutSibling = createCopiedTree(false);
    assert.ok(existsSync(join(withSibling.treeRoot, "file-history")));
    assert.ok(!existsSync(join(withoutSibling.treeRoot, "file-history")));
});

test("test_load_minimal_transcript_and_write_blob_for_session_create_readable_files", () => {
    const { treeRoot, projectDir } = createCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "t.jsonl", "dddddddd-1111-2222-3333-444444444444");
    assert.equal(records.length, 1);
    writeBlobForSession(treeRoot, "dddddddd-1111-2222-3333-444444444444", "blob@v1", "hello");
    const blobPath = join(treeRoot, "file-history", "dddddddd-1111-2222-3333-444444444444", "blob@v1");
    assert.equal(readFileSync(blobPath, "utf8"), "hello");
});
