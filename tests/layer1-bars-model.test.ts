import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildBarFileModels,
    computeFillPercent,
    countChangesNewerThanRow,
    describeFinalState,
    describeFoldedState,
    describeStreamStep,
    isBarFileChangedSince,
    BarMarkKind,
    type BarFileModel,
} from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile } from "./layer1-bars-test-helpers.ts";

function buildInstantAtHour(hour: number): string {
    return `2026-11-13T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function buildRow(rowIndex: number): RulerRow {
    const instant = buildInstantAtHour(12 - rowIndex);
    return { axisPx: 0, text: `row ${rowIndex}`, eventCount: 1, axisPxList: [0], instants: [instant] };
}

// Newest first: row 0 holds 12:00, row 1 holds 11:00, row 2 holds 10:00, row 3 holds 09:00, row 4 holds 08:00.
function buildFiveRows(): RulerRow[] {
    return [0, 1, 2, 3, 4].map(buildRow);
}

function buildCommitAtHour(hour: number, overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ commitHash: `c${hour}`, instant: buildInstantAtHour(hour), ...overrides });
}

function buildModel(commits: InverseCommitWire[]): BarFileModel {
    const models = buildBarFileModels([buildInverseFile("a.txt", commits)], buildFiveRows());
    const model = models[0];
    assert.ok(model);
    return model;
}

// [disk now, commit at 11:00, edit at 10:00, created at 08:00 (born row 4)]
function buildFileOnDisk(): BarFileModel {
    return buildModel([
        buildDiskNowCommit(),
        buildCommitAtHour(11),
        buildCommitAtHour(10, { eventType: "EditRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
}

// [disk now (absent), gone commit at 10:00 (row 2), write at 09:00, created at 08:00 (born row 4)]
function buildFileGoneNow(goneOverrides: Partial<InverseCommitWire>): BarFileModel {
    return buildModel([
        buildDiskNowCommit({ isFileAbsent: true }),
        buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true, ...goneOverrides }),
        buildCommitAtHour(9, { eventType: "WriteRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
}

test("test_dots_keep_the_commit_order_and_include_the_disk_and_created_dots", () => {
    // Step: build a file with a disk now commit, two changes and a creation.
    const model = buildFileOnDisk();
    // Step: the dots follow the commit order, with the disk dot first and the created dot last.
    assert.deepEqual(model.dots.map((dot) => dot.kind), ["disk", "commit", "edit", "created"]);
    assert.deepEqual(model.dots.map((dot) => dot.commitIndex), [0, 1, 2, 3]);
    // Step: each dot sits on the ruler row that holds its time (disk now is row 0).
    assert.deepEqual(model.dots.map((dot) => dot.rowIndex), [0, 1, 2, 4]);
});

test("test_changes_leave_out_the_disk_and_created_dots", () => {
    // Step: build a file with a disk now commit, two changes and a creation.
    const model = buildFileOnDisk();
    // Step: only the commit dot and the edit dot are changes.
    assert.deepEqual(model.changes.map((dot) => dot.kind), ["commit", "edit"]);
});

test("test_born_row_is_the_row_of_the_created_dot", () => {
    // Step: build a file whose creation commit is at 09:00, which is row 3.
    const model = buildModel([buildDiskNowCommit(), buildCommitAtHour(9, { eventType: "WriteRow", isFileAbsent: true })]);
    // Step: the born row is row 3.
    assert.equal(model.bornRowIndex, 3);
});

test("test_born_row_is_the_last_row_when_there_is_no_created_dot", () => {
    // Step: build a file with no absent commit, so no creation is known.
    const model = buildModel([buildDiskNowCommit(), buildCommitAtHour(11)]);
    // Step: the born row is the last row (row 4 of 5 rows).
    assert.equal(model.bornRowIndex, 4);
});

test("test_a_deleted_file_has_no_created_dot_at_its_newer_absent_commits", () => {
    // Step: build a deleted file: disk now (absent), a removing commit, a present commit, an oldest absent commit.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: the removing commit is a deleted dot, and only the oldest commit is a created dot.
    assert.deepEqual(model.dots.map((dot) => dot.kind), ["deleted", "write", "created"]);
});

test("test_a_removed_commit_makes_a_removed_mark_at_its_row", () => {
    // Step: build a deleted file whose removing commit is at 10:00, which is row 2.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: one removed mark sits at row 2 with no destination.
    assert.deepEqual(model.marks, [{ kind: BarMarkKind.removed, rowIndex: 2, movedAwayTo: null }]);
});

test("test_a_moved_away_commit_makes_a_moved_away_mark_with_its_destination", () => {
    // Step: build a moved away file whose moving commit is at 10:00, which is row 2.
    const model = buildFileGoneNow({ movedAwayTo: "/project/b.txt" });
    // Step: one moved away mark sits at row 2 and holds the destination.
    assert.deepEqual(model.marks, [{ kind: BarMarkKind.movedAway, rowIndex: 2, movedAwayTo: "/project/b.txt" }]);
});

test("test_a_commit_with_neither_flag_makes_no_mark", () => {
    // Step: build a file on disk with no flagged commit.
    const model = buildFileOnDisk();
    // Step: the file has no marks.
    assert.deepEqual(model.marks, []);
});

test("test_a_commit_with_both_flags_throws", () => {
    // Step: build a file with one commit that is both removed and moved away.
    const commits = [buildDiskNowCommit(), buildCommitAtHour(11, { isRemoved: true, movedAwayTo: "/project/b.txt" })];
    // Step: building the model throws.
    assert.throws(() => buildModel(commits));
});

test("test_an_absent_commit_that_is_not_created_is_a_change", () => {
    // Step: build a file on disk that has an absent commit between two present commits.
    const model = buildModel([
        buildDiskNowCommit(),
        buildCommitAtHour(11, { eventType: "EditRow", isFileAbsent: true }),
        buildCommitAtHour(10),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
    // Step: the absent commit is a change with the kind of its event type.
    assert.deepEqual(model.changes.map((dot) => dot.kind), ["edit", "commit"]);
});

test("test_plus_is_shown_only_when_the_file_was_created_before_the_last_row", () => {
    // Step: a file created at row 3 shows the plus sign.
    const createdBeforeLastRow = buildModel([buildDiskNowCommit(), buildCommitAtHour(9, { eventType: "WriteRow", isFileAbsent: true })]);
    assert.equal(createdBeforeLastRow.isPlusShown, true);
    // Step: a file created at the last row (row 4) shows no plus sign.
    const createdAtLastRow = buildModel([buildDiskNowCommit(), buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true })]);
    assert.equal(createdAtLastRow.isPlusShown, false);
    // Step: a file with no created dot shows no plus sign.
    const neverCreated = buildModel([buildDiskNowCommit(), buildCommitAtHour(11)]);
    assert.equal(neverCreated.isPlusShown, false);
});

test("test_change_alpha_follows_the_commit_confidence", () => {
    // Step: build a file whose changes have the confidences proven, confirmed and derived.
    const model = buildModel([
        buildDiskNowCommit({ confidence: "unknown" }),
        buildCommitAtHour(11, { confidence: "proven" }),
        buildCommitAtHour(10, { confidence: "confirmed" }),
        buildCommitAtHour(9, { confidence: "derived" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true, confidence: "derived" }),
    ]);
    // Step: the change alphas are 1, 0.75 and 0.4.
    assert.deepEqual(model.changes.map((dot) => dot.alpha), [1, 0.75, 0.4]);
    // Step: the disk dot and the created dot have alpha 1 whatever their confidence.
    assert.deepEqual(model.dots.filter((dot) => dot.kind === "disk" || dot.kind === "created").map((dot) => dot.alpha), [1, 1]);
});

test("test_a_file_with_no_change_newer_than_the_row_is_not_changed_since", () => {
    // Step: build a file with its newest change at row 1 and its birth at row 4.
    const model = buildFileOnDisk();
    // Step: at row 1 nothing is newer than the row, and the file was born earlier.
    assert.equal(isBarFileChangedSince(model, 1), false);
});

test("test_a_file_with_a_change_newer_than_the_row_is_changed_since", () => {
    // Step: build a file with its newest change at row 1.
    const model = buildFileOnDisk();
    // Step: at row 2 the change at row 1 is newer than the row.
    assert.equal(isBarFileChangedSince(model, 2), true);
});

test("test_a_file_created_after_the_row_is_changed_since", () => {
    // Step: build a file with no change and its birth at row 2.
    const model = buildModel([buildDiskNowCommit(), buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true })]);
    // Step: at row 3 the file did not exist yet, so it is changed since.
    assert.equal(isBarFileChangedSince(model, 3), true);
});

test("test_count_of_changes_newer_than_the_row", () => {
    // Step: build a file with changes at rows 1 and 2.
    const model = buildFileOnDisk();
    // Step: at row 1 no change is newer. At row 2 one is. At row 3 two are.
    assert.equal(countChangesNewerThanRow(model, 1), 0);
    assert.equal(countChangesNewerThanRow(model, 2), 1);
    assert.equal(countChangesNewerThanRow(model, 3), 2);
});

test("test_fill_percent_is_zero_at_row_zero_and_one_hundred_at_the_born_row", () => {
    // Step: build a file on disk that is born at row 4.
    const model = buildFileOnDisk();
    // Step: the fill is 0 at row 0, 50 at row 2 and 100 at row 4.
    assert.equal(computeFillPercent(model, 0), 0);
    assert.equal(computeFillPercent(model, 2), 50);
    assert.equal(computeFillPercent(model, 4), 100);
});

test("test_final_state_text_counts_undone_changes", () => {
    // Step: build a file with two changes, at rows 1 and 2.
    const model = buildFileOnDisk();
    // Step: at row 2 one of the two changes is undone.
    assert.equal(describeFinalState(model, 2), "Undid 1 of 2 changes");
});

test("test_final_state_text_says_did_not_exist_yet_before_the_born_row", () => {
    // Step: build a file born at row 3.
    const model = buildModel([buildDiskNowCommit(), buildCommitAtHour(9, { eventType: "WriteRow", isFileAbsent: true })]);
    // Step: at row 4 the file did not exist yet.
    assert.equal(describeFinalState(model, 4), "did not exist yet");
});

test("test_stream_step_text_for_known_and_unknown_counts", () => {
    // Step: a known count reads "step D of T".
    assert.equal(describeStreamStep(2, 5), "step 2 of 5");
    // Step: a missing count reads "waiting".
    assert.equal(describeStreamStep(undefined, 5), "waiting");
    assert.equal(describeStreamStep(2, undefined), "waiting");
});

test("test_a_file_gone_now_has_no_disk_dot", () => {
    // Step: build a deleted file.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: no dot has the kind disk, and the DiskNow commit (index 0) has no dot.
    assert.equal(model.dots.some((dot) => dot.kind === "disk"), false);
    assert.equal(model.dots.some((dot) => dot.commitIndex === 0), false);
    // Step: the commit list still holds all four commits.
    assert.equal(model.commits.length, 4);
});

test("test_the_start_row_of_a_file_gone_now_is_the_row_of_its_gone_commit", () => {
    // Step: build a deleted file and a moved away file, both gone at 10:00 (row 2).
    const deletedModel = buildFileGoneNow({ isRemoved: true });
    const movedModel = buildFileGoneNow({ movedAwayTo: "/project/b.txt" });
    // Step: both start at row 2 and name their mark kind.
    assert.equal(deletedModel.startRowIndex, 2);
    assert.equal(deletedModel.goneMarkKind, BarMarkKind.removed);
    assert.equal(movedModel.startRowIndex, 2);
    assert.equal(movedModel.goneMarkKind, BarMarkKind.movedAway);
});

test("test_the_start_row_of_a_file_on_disk_is_zero", () => {
    // Step: build a file on disk.
    const model = buildFileOnDisk();
    // Step: it starts at row 0 and has no gone mark kind.
    assert.equal(model.startRowIndex, 0);
    assert.equal(model.goneMarkKind, undefined);
});

test("test_fill_percent_of_a_file_gone_now_counts_from_its_start_row", () => {
    // Step: build a deleted file that starts at row 2 and is born at row 4.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: the fill is 0 at and before the start row, 50 at row 3 and 100 at the born row.
    assert.equal(computeFillPercent(model, 0), 0);
    assert.equal(computeFillPercent(model, 2), 0);
    assert.equal(computeFillPercent(model, 3), 50);
    assert.equal(computeFillPercent(model, 4), 100);
    // Step: a file created and gone in one row uses a span of one row, not zero.
    const sameRowModel = buildModel([
        buildDiskNowCommit({ isFileAbsent: true }),
        buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true, isRemoved: true }),
        buildCommitAtHour(10, { eventType: "WriteRow" }),
        buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
    assert.equal(computeFillPercent(sameRowModel, 3), 100);
});

test("test_a_file_gone_now_is_changed_since_a_row_at_or_older_than_its_start_row", () => {
    // Step: build a deleted file that starts at row 2, with its newest change at row 3.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: at row 1 (newer than the start row) the file is not changed since.
    assert.equal(isBarFileChangedSince(model, 1), false);
    // Step: at row 2 (the start row) the file is changed since.
    assert.equal(isBarFileChangedSince(model, 2), true);
});

test("test_folded_text_of_a_deleted_file_newer_than_its_start_row_is_deleted_not_restored_yet", () => {
    // Step: build a deleted file that starts at row 2.
    const model = buildFileGoneNow({ isRemoved: true });
    // Step: at row 1 it reads "deleted, not restored yet". At row 2 it reads "same as now".
    assert.equal(describeFoldedState(model, 1), "deleted, not restored yet");
    assert.equal(describeFoldedState(model, 2), "same as now");
});

test("test_folded_text_of_a_moved_away_file_newer_than_its_start_row_is_moved_away_not_restored_yet", () => {
    // Step: build a moved away file that starts at row 2.
    const model = buildFileGoneNow({ movedAwayTo: "/project/b.txt" });
    // Step: at row 1 it reads "moved away, not restored yet". At row 2 it reads "same as now".
    assert.equal(describeFoldedState(model, 1), "moved away, not restored yet");
    assert.equal(describeFoldedState(model, 2), "same as now");
});

test("test_folded_text_of_a_file_on_disk_is_same_as_now", () => {
    // Step: build a file on disk.
    const model = buildFileOnDisk();
    // Step: it reads "same as now" at any row.
    assert.equal(describeFoldedState(model, 0), "same as now");
    assert.equal(describeFoldedState(model, 3), "same as now");
});
