import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBarFileModels, type BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { renderBarsRowList, toggleBarsFold } from "../webapp/layer1-components/bars-view/layer1-bars-rowlist.ts";
import { createBarsViewState, type BarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, initBarsDom } from "./layer1-bars-test-helpers.ts";

function buildInstantAtHour(hour: number): string {
    return `2026-11-13T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

// Newest first: row 0 holds 12:00, row 1 holds 11:00, row 2 holds 10:00, row 3 holds 09:00, row 4 holds 08:00.
function buildFiveRows(): RulerRow[] {
    return [0, 1, 2, 3, 4].map((rowIndex) => ({ axisPx: 0, text: `row ${rowIndex}`, eventCount: 1, axisPxList: [0], instants: [buildInstantAtHour(12 - rowIndex)] }));
}

function buildCommitAtHour(hour: number, overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ commitHash: `c${hour}`, instant: buildInstantAtHour(hour), ...overrides });
}

function buildModel(path: string, commits: InverseCommitWire[]): BarFileModel {
    const model = buildBarFileModels([buildInverseFile(path, commits)], buildFiveRows())[0];
    assert.ok(model);
    return model;
}

// Changes at rows 1 and 2, born at row 4.
function buildChangedModel(path: string): BarFileModel {
    return buildModel(path, [
        buildDiskNowCommit(),
        buildCommitAtHour(11),
        buildCommitAtHour(10, { eventType: "EditRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
}

// No change at all, born at the last row.
function buildUnchangedModel(path: string): BarFileModel {
    return buildModel(path, [buildDiskNowCommit()]);
}

// Gone commit at row 2, one change at row 3, born at row 4.
function buildGoneModel(path: string, goneOverrides: Partial<InverseCommitWire>): BarFileModel {
    return buildModel(path, [
        buildDiskNowCommit({ isFileAbsent: true }),
        buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true, ...goneOverrides }),
        buildCommitAtHour(9, { eventType: "WriteRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ]);
}

function buildState(models: BarFileModel[], selectedRowIndex: number): BarsViewState {
    const state = createBarsViewState();
    state.rulerRows = buildFiveRows();
    state.models = models;
    state.selectedRowIndex = selectedRowIndex;
    return state;
}

function listRowPaths(selector: string): string[] {
    return Array.from(document.querySelectorAll(selector)).map((rowElement) => rowElement.querySelector(".barsFilePath")?.textContent ?? "");
}

function findRequired(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    assert.ok(found, selector);
    return found;
}

test("test_files_with_no_change_since_the_row_go_under_the_fold_line", () => {
    // Step: one changed file and one unchanged file, selected row 2.
    initBarsDom();
    const state = buildState([buildChangedModel("changed.ts"), buildUnchangedModel("same.ts")], 2);
    renderBarsRowList(state, false);
    // Step: the changed file sits straight in the row list.
    assert.deepEqual(listRowPaths("#barsRowList > .barsFileRow"), ["changed.ts"]);
    // Step: the unchanged file sits in the folded list, as a folded row.
    assert.deepEqual(listRowPaths("#barsRowList > .barsFoldedList > .barsFoldedRow"), ["same.ts"]);
    // Step: the state keeps both rows in model order.
    assert.equal(state.rowElements.length, 2);
});

test("test_the_fold_line_counts_the_folded_files", () => {
    // Step: two unchanged files and one changed file.
    initBarsDom();
    renderBarsRowList(buildState([buildChangedModel("a.ts"), buildUnchangedModel("b.ts"), buildUnchangedModel("c.ts")], 2), false);
    // Step: the fold line names the count and starts with the arrow.
    const foldLine = findRequired(".barsFoldLine");
    assert.equal(foldLine.textContent, "==> 2 files with no change since this row [hide]");
    assert.equal(findRequired(".barsFoldLine > .barsArrow").textContent, "==>");
});

test("test_there_is_no_fold_line_when_every_file_changed", () => {
    // Step: only changed files.
    initBarsDom();
    renderBarsRowList(buildState([buildChangedModel("a.ts"), buildChangedModel("b.ts")], 2), false);
    // Step: no fold line and no folded list.
    assert.equal(document.querySelectorAll(".barsFoldLine").length, 0);
    assert.equal(document.querySelectorAll(".barsFoldedList").length, 0);
    assert.equal(document.querySelectorAll("#barsRowList > .barsFileRow").length, 2);
});

test("test_the_fold_list_is_open_by_default", () => {
    // Step: render one unchanged file with the default state.
    initBarsDom();
    renderBarsRowList(buildState([buildUnchangedModel("a.ts")], 2), false);
    // Step: the list shows and the toggle offers [hide].
    assert.equal(findRequired(".barsFoldedList").style.display, "block");
    assert.equal(findRequired(".barsFoldToggle").textContent, "[hide]");
});

test("test_toggling_the_fold_hides_the_list_and_shows_show", () => {
    // Step: render one unchanged file.
    initBarsDom();
    const state = buildState([buildUnchangedModel("a.ts")], 2);
    renderBarsRowList(state, false);
    // Step: toggle once.
    toggleBarsFold(state);
    // Step: the list is hidden and the toggle offers [show].
    assert.equal(state.isFoldShown, false);
    assert.equal(findRequired(".barsFoldedList").style.display, "none");
    assert.equal(findRequired(".barsFoldToggle").textContent, "[show]");
    // Step: toggle again; the list shows again.
    toggleBarsFold(state);
    assert.equal(findRequired(".barsFoldedList").style.display, "block");
    assert.equal(findRequired(".barsFoldToggle").textContent, "[hide]");
});

test("test_a_folded_row_reads_same_as_now", () => {
    // Step: render one unchanged file.
    initBarsDom();
    renderBarsRowList(buildState([buildUnchangedModel("a.ts")], 2), false);
    // Step: the folded row reads "same as now".
    assert.equal(findRequired(".barsFoldedRow .barsColRight").textContent, "same as now");
});

test("test_a_deleted_file_folded_newer_than_its_start_row_reads_deleted_not_restored_yet", () => {
    // Step: a deleted file whose gone commit is at row 2; selected row 1 is newer.
    initBarsDom();
    renderBarsRowList(buildState([buildGoneModel("gone.ts", { isRemoved: true })], 1), false);
    // Step: the folded row says deleted.
    assert.equal(findRequired(".barsFoldedRow .barsColRight").textContent, "deleted, not restored yet");
});

test("test_a_moved_away_file_folded_newer_than_its_start_row_reads_moved_away_not_restored_yet", () => {
    // Step: a moved away file whose gone commit is at row 2; selected row 1 is newer.
    initBarsDom();
    renderBarsRowList(buildState([buildGoneModel("gone.ts", { movedAwayTo: "/other/gone.ts" })], 1), false);
    // Step: the folded row says moved away.
    assert.equal(findRequired(".barsFoldedRow .barsColRight").textContent, "moved away, not restored yet");
});

test("test_a_changed_row_reads_undid_k_of_n_changes", () => {
    // Step: a file with changes at rows 1 and 2, selected row 2.
    initBarsDom();
    renderBarsRowList(buildState([buildChangedModel("a.ts")], 2), false);
    // Step: one of two changes is undone.
    assert.equal(findRequired("#barsRowList > .barsFileRow .barsColRight").textContent, "Undid 1 of 2 changes");
});

test("test_a_changed_row_fill_goes_to_the_selected_row", () => {
    // Step: a file with changes, born at row 4, selected row 2.
    initBarsDom();
    const state = buildState([buildChangedModel("a.ts")], 2);
    renderBarsRowList(state, false);
    // Step: the fill reaches row 2 of 4 bar rows: 50 percent.
    assert.equal(state.rowElements[0]?.fillElement.style.width, "50%");
});

test("test_a_file_created_after_the_selected_row_reads_did_not_exist_yet", () => {
    // Step: a file born at row 2, selected row 3.
    initBarsDom();
    const model = buildModel("new.ts", [buildDiskNowCommit(), buildCommitAtHour(10, { eventType: "WriteRow", isFileAbsent: true })]);
    renderBarsRowList(buildState([model], 3), false);
    // Step: the changed row says the file did not exist yet.
    assert.equal(findRequired("#barsRowList > .barsFileRow .barsColRight").textContent, "did not exist yet");
});

test("test_the_placeholder_flag_makes_the_dots_placeholders", () => {
    // Step: render the same changed file twice, once with the flag and once without.
    initBarsDom();
    renderBarsRowList(buildState([buildChangedModel("a.ts")], 2), true);
    const dotCount = document.querySelectorAll(".BarDot").length;
    assert.ok(dotCount > 0);
    // Step: with the flag every dot is a placeholder.
    assert.equal(document.querySelectorAll(".BarDot.dotPlaceholder").length, dotCount);
    // Step: without the flag no dot is a placeholder.
    renderBarsRowList(buildState([buildChangedModel("a.ts")], 2), false);
    assert.equal(document.querySelectorAll(".BarDot.dotPlaceholder").length, 0);
});
