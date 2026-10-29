// Tests src/viewer_api_consent.ts: the gates stand aside when nothing needs asking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBaselineQuestion, computeDocumentDecision } from "../src/viewer_api_consent.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

test("test_computeDocumentDecision_builds_for_no_records", () => {
    assert.deepEqual(computeDocumentDecision([], false), { kind: DocumentResponseKind.document });
});

test("test_computeBaselineQuestion_is_undefined_without_overrides", () => {
    setPathOverrides({});
    assert.equal(computeBaselineQuestion(false), undefined);
});
