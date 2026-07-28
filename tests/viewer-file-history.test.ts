// Tests for the file-history view model. See tests/viewer-test-helpers.ts for fixture rationale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTrailingNewline } from "../src/reconstruction_steps.ts";
import { buildFileHistoryViewModel, computeAnchoredRevisionIndex, findRevisionForChangeId, splitDiffBlocks } from "../webapp/views/file-history-model.ts";
import { buildS19ClientDocument } from "./viewer-test-helpers.ts";

const S19_STEP_STATES_DIR = "scenarios/executed/s19-user-edit-conv-rewind/.step_states";

function findScenario19Target(document: any): string {
    const history = document.filesTouched.find((entry: any) => entry.target.endsWith("scenario19.py"));
    assert.ok(history !== undefined, "s19 touches scenario19.py");
    return history.target;
}

// Ground-truth states end in a trailing newline the engine strips; compare both sides via stripTrailingNewline like the coverage checker.
function readStrippedGroundTruth(stepName: string): string {
    return stripTrailingNewline(readFileSync(`${S19_STEP_STATES_DIR}/${stepName}/scenario19.py`, "utf8"));
}

test("test_file_state_viewmodel_matches_scenario_step_states", () => {
    // The final revision must equal the scenario's step-009 ground truth.
    const document = buildS19ClientDocument();
    const target = findScenario19Target(document);
    const viewModel = buildFileHistoryViewModel(document, target);
    assert.ok(viewModel.revisions.length >= 2, `2+ revisions, got ${viewModel.revisions.length}`);
    const finalRevision = viewModel.revisions[viewModel.revisions.length - 1]!;
    assert.equal(stripTrailingNewline(finalRevision.content!), readStrippedGroundTruth("step-009"));
});

test("test_file_state_viewmodel_matches_intermediate_step", () => {
    // Per-revision lookup must be correct at INTERMEDIATE points, not just the endpoint.
    const document = buildS19ClientDocument();
    const target = findScenario19Target(document);
    const viewModel = buildFileHistoryViewModel(document, target);
    const intermediateGroundTruth = readStrippedGroundTruth("step-003");
    assert.notEqual(intermediateGroundTruth, readStrippedGroundTruth("step-009"), "the intermediate state is genuinely different");
    const nonFinalContents = viewModel.revisions.slice(0, -1).map((revision: any) => stripTrailingNewline(revision.content));
    assert.ok(nonFinalContents.includes(intermediateGroundTruth), "a non-final revision carries the step-003 state");
});

test("test_computeAnchoredRevisionIndex_returns_zero_based_index_for_in_range_rev", () => {
    // Route segments are 1-based; the returned index is 0-based.
    const anchoredIndex = computeAnchoredRevisionIndex("2", 3);
    assert.equal(anchoredIndex, 1);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_missing_rev", () => {
    const anchoredIndex = computeAnchoredRevisionIndex(undefined, 3);
    assert.equal(anchoredIndex, undefined);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_non_numeric_rev", () => {
    const anchoredIndex = computeAnchoredRevisionIndex("abc", 3);
    assert.equal(anchoredIndex, undefined);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_out_of_range_rev", () => {
    // 0 is below the 1-based floor; 4 is past a 3-revision list.
    const belowRange = computeAnchoredRevisionIndex("0", 3);
    const aboveRange = computeAnchoredRevisionIndex("4", 3);
    assert.equal(belowRange, undefined);
    assert.equal(aboveRange, undefined);
});

test("test_findRevisionForChangeId_returns_target_and_one_based_revision_number", () => {
    // The click needs the file target and the 1-based /rev/<n> number.
    const document = buildS19ClientDocument();
    const history = document.filesTouched.find((entry: any) => entry.revisions.length >= 2);
    assert.ok(history !== undefined, "s19 has a file with 2+ revisions");
    const found = findRevisionForChangeId(document.filesTouched, history.revisions[1].changeId);
    assert.deepEqual(found, { target: history.target, revisionNumber: 2 });
});

test("test_findRevisionForChangeId_falls_back_to_file_match_for_other_backup_version", () => {
    // Across blob versions the file is identifiable by the prefix, the revision is not.
    const filesTouched = [{ target: "/tmp/a.py", revisions: [{ changeId: "5436e8e9f917cd04@v3" }] }];
    const found = findRevisionForChangeId(filesTouched, "5436e8e9f917cd04@v2");
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: undefined });
});

test("test_findRevisionForChangeId_does_not_prefix_match_non_blob_values", () => {
    // Only @vN-shaped blob names may fall back to a prefix match.
    const filesTouched = [{ target: "/tmp/a.py", revisions: [{ changeId: "toolu_015cK8abc" }] }];
    const found = findRevisionForChangeId(filesTouched, "toolu_015cK8");
    assert.equal(found, undefined);
});

test("test_findRevisionForChangeId_resolves_backup_version_by_backup_time", () => {
    // When the blob version matches nothing, the revision in effect at backupTime is the state the backup captured.
    const filesTouched = [{
        target: "/tmp/a.py",
        revisions: [
            { changeId: "toolu_1", timestamp: "2026-06-27T04:23:36.784Z" },
            { changeId: "toolu_2", timestamp: "2026-06-27T04:28:29.007Z" },
            { changeId: "5436e8e9f917cd04@v3", timestamp: "2026-06-27T04:31:35.020Z" },
        ],
    }];
    // A backupTime between the second and third revisions resolves to #2.
    const found = findRevisionForChangeId(filesTouched, "5436e8e9f917cd04@v2", "2026-06-27T04:29:36.586Z");
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: 2 });
});

test("test_findRevisionForChangeId_leaves_revision_unresolved_for_backup_time_before_all_revisions", () => {
    // A backupTime earlier than every revision names no state the document knows.
    const filesTouched = [{
        target: "/tmp/a.py",
        revisions: [{ changeId: "abc@v3", timestamp: "2026-06-27T04:31:35.020Z" }],
    }];
    const found = findRevisionForChangeId(filesTouched, "abc@v1", "2026-06-27T04:00:00.000Z");
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: undefined });
});

test("test_findRevisionForChangeId_returns_undefined_for_unknown_changeId", () => {
    const document = buildS19ClientDocument();
    const found = findRevisionForChangeId(document.filesTouched, "not-a-change-id");
    assert.equal(found, undefined);
});

// -------------------- per-revision block slicing --------------------

test("test_splitDiffBlocks_keeps_numeric_hunk_headers_inside_their_revision_block", () => {
    // Numeric hunk headers can appear inside a revision block; slicing must split only on revision-kind headers, not hunk headers.
    const blocks = splitDiffBlocks([
        "@@ created @ 2026-01-01T00:00:00.000Z @@",
        "@@ -0,0 +1,1 @@",
        "+line one",
        "@@ changed @ 2026-01-01T00:01:00.000Z @@",
        "@@ -1,2 +1,2 @@",
        "-old",
        "+new",
        "@@ -9,1 +9,1 @@",
        "-tail old",
        "+tail new",
    ].join("\n"));
    // exactly one block per revision.
    assert.equal(blocks.length, 2);
    // each numeric hunk stays inside its revision's block.
    assert.ok(blocks[0]!.includes("@@ -0,0 +1,1 @@"));
    assert.ok(blocks[1]!.includes("@@ -1,2 +1,2 @@"));
    assert.ok(blocks[1]!.includes("@@ -9,1 +9,1 @@"));
});
