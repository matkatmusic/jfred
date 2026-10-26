// Tests src/viewer_api.ts: the label formatter and the document wrappers over the cached build.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildDocumentWithConsent,
    buildProjectDocument,
    buildReconstructionWithConsent,
    formatSendingDocumentLabel,
} from "../src/viewer_api.ts";
import { Path } from "../src/structures/domain.ts";
import { S1_JSONL } from "./fixtures.ts";

test("test_formatSendingDocumentLabel_shows_megabytes_with_one_decimal", () => {
    assert.equal(formatSendingDocumentLabel(2_540_000), "sending document (2.5 MB)");
});

test("test_buildProjectDocument_returns_a_document_with_files_touched", () => {
    const document = buildProjectDocument([new Path(S1_JSONL)], undefined);
    assert.ok(Array.isArray(document.filesTouched));
});

test("test_buildDocumentWithConsent_returns_the_cached_build_document", () => {
    const paths = [new Path(S1_JSONL)];
    const built = buildReconstructionWithConsent(paths, undefined, false);
    assert.equal(buildDocumentWithConsent(paths, undefined, false), built.document);
});
