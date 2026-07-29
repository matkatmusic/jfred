// Task 119: the wire document's partial-reconstruction fields (skippedLines / failures).  Split from tests/reconstruction_json.test.ts (250-line cap); same loadRecords + S19_JSONL shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReconstructionDocument } from "../src/reconstruction_json.ts";
import { reconstructBranches } from "../src/reconstruction_engine.ts";
import { FailureScope } from "../src/structures/vocabulary.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { SkippedLine } from "../src/parse/loadTranscript.ts";
import {
    clearReconstructionFailures,
    noteReconstructionFailure,
} from "../src/reconstruction_health.ts";
import { Path } from "../src/structures/domain.ts";
import {
    createSidecarReader,
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

function realReader(records: ReturnType<typeof loadRecords>): BackupReader | undefined {
    const sessionId = findSessionId(records);
    return sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
}

const records = loadRecords(S19_JSONL);
const reader = realReader(records);

test("test_buildReconstructionDocument_carries_skipped_lines_through", () => {
    // Behavior: the tolerant parse's skipped lines ride the wire document unchanged (the webapp's timeline gap rows come from them).
    const branched = reconstructBranches(records, reader);
    const skipped: SkippedLine[] = [
        { filePath: new Path(S19_JSONL), lineNumber: 7, reason: 'unknown record type "future-nonsense"' },
    ];
    const { document } = buildReconstructionDocument(records, branched, reader, undefined, skipped);
    // Verify: the fabricated skip is carried through.
    assert.equal(document.skippedLines.length, 1);
    assert.equal(document.skippedLines[0]!.lineNumber, 7);
});

test("test_buildReconstructionDocument_drains_failures_into_document", () => {
    // Behavior: failures noted before the document assembly (engine stages run earlier in the build) are drained into document.failures — and drained means gone: a second build has none.
    const branched = reconstructBranches(records, reader);
    clearReconstructionFailures();
    noteReconstructionFailure({ scope: FailureScope.fileStage, stage: "testStage", reason: "fabricated" });
    const first = buildReconstructionDocument(records, branched, reader, undefined);
    // Verify: the noted failure appears on the document, then a second build reports none.
    assert.ok(first.document.failures.some((failure) => failure.stage === "testStage"));
    const second = buildReconstructionDocument(records, branched, reader, undefined);
    assert.equal(second.document.failures.length, 0);
});
