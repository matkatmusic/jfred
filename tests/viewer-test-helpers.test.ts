// Tests for the shared viewer test helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildS19ClientDocument } from "./viewer-test-helpers.ts";

test("test_the_s19_client_document_survives_a_json_round_trip_unchanged", () => {
    const document = buildS19ClientDocument();
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document);
});

test("test_the_s19_client_document_lists_the_files_it_touched", () => {
    const document = buildS19ClientDocument();
    assert.ok(document.filesTouched.length > 0);
    assert.equal(typeof document.filesTouched[0].target, "string");
});
