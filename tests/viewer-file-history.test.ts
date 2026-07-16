// Tests for the file-history view model (webapp/views/file-history-model.ts — plain ES module,
// DOM-free): revision content vs scenario ground truth, revision anchoring, changeId lookup,
// and per-revision diff block slicing. See tests/viewer-test-helpers.ts for the fixture rationale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTrailingNewline } from "../src/reconstruction_steps.ts";
import { buildFileHistoryViewModel, computeAnchoredRevisionIndex, findRevisionForChangeId, splitDiffBlocks } from "../webapp/views/file-history-model.ts";
import { buildS19ClientDocument } from "./viewer-test-helpers.ts";

const S19_STEP_STATES_DIR = "scenarios/executed/s19-user-edit-conv-rewind/.step_states";

// The scenario19.py target string in a client document.
function findScenario19Target(document: any): string {
    const history = document.filesTouched.find((entry: any) => entry.target.endsWith("scenario19.py"));
    assert.ok(history !== undefined, "s19 touches scenario19.py");
    return history.target;
}

// Ground-truth file states end in a trailing newline the engine's snapshots normalize away;
// compare both sides through the same stripTrailingNewline the coverage checker uses.
function readStrippedGroundTruth(stepName: string): string {
    return stripTrailingNewline(readFileSync(`${S19_STEP_STATES_DIR}/${stepName}/scenario19.py`, "utf8"));
}

test("test_file_state_viewmodel_matches_scenario_step_states", () => {
    // Scenario: the file-history view model's content at the FINAL revision of scenario19.py
    // equals the final state recorded in the scenario's .step_states/ ground truth (step-009).
    const document = buildS19ClientDocument();
    const target = findScenario19Target(document);
    const viewModel = buildFileHistoryViewModel(document, target);
    // s19's surviving branch carries this file's write -> overwrite -> edit (multiple revisions).
    assert.ok(viewModel.revisions.length >= 2, `2+ revisions, got ${viewModel.revisions.length}`);
    // assert the final revision's derived content equals the recorded final step state.
    const finalRevision = viewModel.revisions[viewModel.revisions.length - 1]!;
    assert.equal(stripTrailingNewline(finalRevision.content!), readStrippedGroundTruth("step-009"));
});

test("test_file_state_viewmodel_matches_intermediate_step", () => {
    // Scenario: per-revision lookup is correct at INTERMEDIATE points, not just the endpoint —
    // some non-final revision's derived content equals the recorded step-003 state (the
    // pre-tweak, post-subtract state), which differs from the final state.
    const document = buildS19ClientDocument();
    const target = findScenario19Target(document);
    const viewModel = buildFileHistoryViewModel(document, target);
    const intermediateGroundTruth = readStrippedGroundTruth("step-003");
    assert.notEqual(intermediateGroundTruth, readStrippedGroundTruth("step-009"), "the intermediate state is genuinely different");
    const nonFinalContents = viewModel.revisions.slice(0, -1).map((revision: any) => stripTrailingNewline(revision.content));
    assert.ok(nonFinalContents.includes(intermediateGroundTruth), "a non-final revision carries the step-003 state");
});

test("test_computeAnchoredRevisionIndex_returns_zero_based_index_for_in_range_rev", () => {
    // Scenario: a route's 1-based /rev/2 segment against a 3-revision history.
    // Action: compute the anchored index.
    const anchoredIndex = computeAnchoredRevisionIndex("2", 3);
    // Assertion: it names the 0-based second revision.
    assert.equal(anchoredIndex, 1);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_missing_rev", () => {
    // Scenario: the route carries no /rev/ segment at all.
    // Action: compute the anchored index with an undefined segment.
    const anchoredIndex = computeAnchoredRevisionIndex(undefined, 3);
    // Assertion: no revision is anchored.
    assert.equal(anchoredIndex, undefined);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_non_numeric_rev", () => {
    // Scenario: a hand-mangled route names /rev/abc.
    // Action: compute the anchored index for the non-numeric segment.
    const anchoredIndex = computeAnchoredRevisionIndex("abc", 3);
    // Assertion: no revision is anchored.
    assert.equal(anchoredIndex, undefined);
});

test("test_computeAnchoredRevisionIndex_returns_undefined_for_out_of_range_rev", () => {
    // Scenario: routes name revision 0 (below the 1-based floor) and 4 (past a 3-revision list).
    // Action: compute both anchored indexes.
    const belowRange = computeAnchoredRevisionIndex("0", 3);
    const aboveRange = computeAnchoredRevisionIndex("4", 3);
    // Assertion: neither anchors a revision.
    assert.equal(belowRange, undefined);
    assert.equal(aboveRange, undefined);
});

test("test_findRevisionForChangeId_returns_target_and_one_based_revision_number", () => {
    // Scenario: an inspector string value equals a revision's changeId (a toolu id or a
    // backup blob name) — the click needs the file target and the 1-based /rev/<n> number.
    const document = buildS19ClientDocument();
    const history = document.filesTouched.find((entry: any) => entry.revisions.length >= 2);
    assert.ok(history !== undefined, "s19 has a file with 2+ revisions");
    // look up the changeId of that history's SECOND revision.
    const found = findRevisionForChangeId(document.filesTouched, history.revisions[1].changeId);
    // the lookup names the same file and the 1-based revision number 2.
    assert.deepEqual(found, { target: history.target, revisionNumber: 2 });
});

test("test_findRevisionForChangeId_falls_back_to_file_match_for_other_backup_version", () => {
    // Scenario: a snapshot names backup blob version @v2, but the document's revision carries
    // the SAME blob at @v3 — the file is identifiable by the blob prefix, the revision is not.
    const filesTouched = [{ target: "/tmp/a.py", revisions: [{ changeId: "5436e8e9f917cd04@v3" }] }];
    // look up the other version of the same blob.
    const found = findRevisionForChangeId(filesTouched, "5436e8e9f917cd04@v2");
    // the file matches; no revision number is named.
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: undefined });
});

test("test_findRevisionForChangeId_does_not_prefix_match_non_blob_values", () => {
    // Scenario: only @vN-shaped blob names may fall back to a prefix match — an ordinary value
    // sharing a changeId's leading characters must not.
    const filesTouched = [{ target: "/tmp/a.py", revisions: [{ changeId: "toolu_015cK8abc" }] }];
    // look up a plain prefix of that changeId.
    const found = findRevisionForChangeId(filesTouched, "toolu_015cK8");
    // no link.
    assert.equal(found, undefined);
});

test("test_findRevisionForChangeId_resolves_backup_version_by_backup_time", () => {
    // Scenario: the snapshot's blob version matches no revision changeId, but the snapshot
    // records WHEN that backup was taken — the revision in effect at that moment is the state
    // the backup captured.
    const filesTouched = [{
        target: "/tmp/a.py",
        revisions: [
            { changeId: "toolu_1", timestamp: "2026-06-27T04:23:36.784Z" },
            { changeId: "toolu_2", timestamp: "2026-06-27T04:28:29.007Z" },
            { changeId: "5436e8e9f917cd04@v3", timestamp: "2026-06-27T04:31:35.020Z" },
        ],
    }];
    // look up blob @v2 with a backupTime between the second and third revisions.
    const found = findRevisionForChangeId(filesTouched, "5436e8e9f917cd04@v2", "2026-06-27T04:29:36.586Z");
    // the revision in effect at backupTime is #2.
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: 2 });
});

test("test_findRevisionForChangeId_leaves_revision_unresolved_for_backup_time_before_all_revisions", () => {
    // Scenario: a backupTime earlier than every revision names no state the document knows.
    const filesTouched = [{
        target: "/tmp/a.py",
        revisions: [{ changeId: "abc@v3", timestamp: "2026-06-27T04:31:35.020Z" }],
    }];
    // look up blob @v1 with a backupTime before the only revision.
    const found = findRevisionForChangeId(filesTouched, "abc@v1", "2026-06-27T04:00:00.000Z");
    // the file matches; no revision is named.
    assert.deepEqual(found, { target: "/tmp/a.py", revisionNumber: undefined });
});

test("test_findRevisionForChangeId_returns_undefined_for_unknown_changeId", () => {
    // Scenario: an ordinary string value that is no revision's changeId.
    const document = buildS19ClientDocument();
    // look up a value that matches nothing.
    const found = findRevisionForChangeId(document.filesTouched, "not-a-change-id");
    // no revision link.
    assert.equal(found, undefined);
});

// -------------------- per-revision block slicing --------------------

test("test_splitDiffBlocks_keeps_numeric_hunk_headers_inside_their_revision_block", () => {
    // Scenario: renderDiffWithContext emits revision-kind headers (block delimiters) with
    // standard numeric "@@ -a,b +c,d @@" hunk headers INSIDE each block; slicing must split
    // only on the revision headers.
    // Steps:
    // slice a two-revision diff whose second block carries two numeric hunks.
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
