// Unit tests for the document and step builders (src/reconstruction_json.ts); message and branch tests live in reconstruction_json_messages.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildReconstructionDocument,
} from "../src/reconstruction_json.ts";
import { buildStepSnapshots } from "../src/reconstruction_json_steps.ts";
import {
    buildBranchedReconstruction,
} from "../src/reconstruction_engine.ts";
import type { FileHistory } from "../src/reconstruction_events.ts";
import { countStepsInTranscript } from "../src/reconstruction_steps.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import {
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

test("test_buildStepSnapshots_produce_skeleton_steps_without_file_contents", () => {
    // A step snapshot has no `files` map — per-step file contents were the wire-size blow-up this fix removes.
    const { steps } = buildStepSnapshots(records, reader, undefined);
    assert.ok(steps.length > 0);
    for (const step of steps) {
        assert.equal(typeof step.index, "number");
        assert.ok(step.when instanceof Date);
        assert.ok(Array.isArray(step.changeIds));
        assert.ok(Array.isArray(step.changedPaths));
        assert.equal((step as Record<string, unknown>)["files"], undefined);
    }
});

test("test_buildReconstructionDocument_returns_branch_agnostic_histories_alongside_document", () => {
    // Compact histories return NEXT TO the document, never as a document field, which would defeat the wire-size fix.
    const branched = buildBranchedReconstruction(records, reader);
    const result = buildReconstructionDocument(records, branched, reader, undefined);
    assert.ok(result.stepFileHistories.length > 0);
    assert.ok(result.stepFileHistories.every((history) => Array.isArray(history.revisions)));
    assert.equal((result.document as Record<string, unknown>)["stepFileHistories"], undefined);
});

test("test_buildStepSnapshots_aligns_steps_with_change_ids", () => {
    // Behavior: one entry per step; index is 1-based and changeIds is a non-empty Uuid[].
    const { steps } = buildStepSnapshots(records, reader, undefined);
    assert.ok(steps.length > 0);
    steps.forEach((step, i) => {
        assert.equal(step.index, i + 1);
        assert.ok(step.changeIds.length > 0);
    });
});

test("test_buildStepSnapshots_changedPaths_link_resolvable_steps_to_touched_files", () => {
    // changedPaths is a best-effort changeId->path hint; off-branch/re-stamped steps may resolve to [] since their changeId isn't surviving.
    const branched = buildBranchedReconstruction(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    const touched = new Set(document.filesTouched.map((h: FileHistory) => h.target.toString()));
    let resolvedAny = false;
    for (const step of document.steps) {
        assert.equal(step.changedPaths.length, new Set(step.changedPaths).size);
        for (const path of step.changedPaths) {
            assert.ok(touched.has(path));
        }
        if (step.changedPaths.length > 0) {
            resolvedAny = true;
        }
    }
    assert.ok(resolvedAny);
});

// (task 134) the three buildLineVerdicts tests moved with their subject to tests/reconstruction_line_verdicts.test.ts.

test("test_buildReconstructionDocument_step_count_matches_countStepsInTranscript", () => {
    // Behavior: the document's step count matches the engine's step counter.
    const branched = buildBranchedReconstruction(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    assert.equal(document.steps.length, countStepsInTranscript(records, reader));
});

test("test_buildReconstructionDocument_includes_messages_branches_and_files", () => {
    // Behavior: messages, branches, filesTouched are all populated for S19.
    const branched = buildBranchedReconstruction(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    assert.ok(document.messages.length > 0);
    assert.ok(document.branches.length > 0);
    assert.ok(document.filesTouched.length > 0);
});

test("test_buildReconstructionDocument_includes_line_verdicts_for_every_record", () => {
    // Behavior: lineVerdicts has one entry per parsed record.
    const branched = buildBranchedReconstruction(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    assert.equal(document.lineVerdicts.length, records.length);
});

// The task-119 skippedLines/failures document tests live in tests/reconstruction_json_health.test.ts (250-line cap split).
