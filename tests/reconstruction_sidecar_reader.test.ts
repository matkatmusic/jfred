// Item 46: file-history-root resolution — sibling derivation, override precedence, default fallback.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    findFileHistoryRootFromRecords,
    findSiblingFileHistoryRoot,
    getDefaultFileHistoryRoot,
    getFileHistoryRoot,
} from "../src/reconstruction_sidecar_reader.ts";
import { createCopiedTree, loadMinimalTranscript } from "./sidecar-reader-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_derive_sibling_file_history_root_finds_existing_sibling", () => {
    // A tree copied out of ~/.claude keeps file-history as a sibling of projects.
    const { treeRoot } = createCopiedTree(true);
    const derived = findSiblingFileHistoryRoot(new Path(join(treeRoot, "projects")));
    assert.equal(derived?.toString(), join(treeRoot, "file-history"));
});

test("test_derive_sibling_file_history_root_returns_undefined_without_sibling", () => {
    // No sibling means no derived root, so the resolution chain moves on to the default.
    const { treeRoot } = createCopiedTree(false);
    assert.equal(findSiblingFileHistoryRoot(new Path(join(treeRoot, "projects"))), undefined);
});

test("test_resolve_file_history_root_prefers_override_over_derivation", () => {
    // An explicit fileHistoryRoot override outranks the transcript-derived sibling.
    const { treeRoot, projectDir } = createCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "session.jsonl");
    assert.equal(findFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    setPathOverrides({ fileHistoryRoot: new Path("/tmp/override-file-history") });
    assert.equal(getFileHistoryRoot(records).toString(), "/tmp/override-file-history");
});

test("test_resolve_file_history_root_falls_back_to_default_without_source_or_override", () => {
    // Records that never went through loadTranscript carry no source to derive from.
    const records = [{ type: RecordType.aiTitle } as unknown as TranscriptRecord];
    assert.equal(getFileHistoryRoot(records).toString(), getDefaultFileHistoryRoot().toString());
});
