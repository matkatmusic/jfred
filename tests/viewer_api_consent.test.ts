// Tests src/viewer_api_consent.ts: the gates stand aside when nothing needs asking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBaselineQuestion, decideDocumentResponse } from "../src/viewer_api_consent.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

test("test_decideDocumentResponse_builds_for_no_records", () => {
    assert.deepEqual(decideDocumentResponse([], false), { kind: DocumentResponseKind.document });
});

test("test_decideBaselineQuestion_is_undefined_without_overrides", () => {
    setPathOverrides({});
    assert.equal(decideBaselineQuestion(false), undefined);
});
