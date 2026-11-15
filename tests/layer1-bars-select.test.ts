import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBarFileModels, type BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { renderBarsRowList } from "../webapp/layer1-components/bars-view/layer1-bars-rowlist.ts";
import { selectBarsRow } from "../webapp/layer1-components/bars-view/layer1-bars-select.ts";
import { createBarsViewState, type BarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, initBarsDom } from "./layer1-bars-test-helpers.ts";

function buildInstantAtHour(hour: number): string {
    return `2026-11-13T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

// Newest first: row 0 holds 12:00, row 1 holds 11:00, row 2 holds 10:00, row 3 holds 09:00, row 4 holds 08:00.
function buildFiveRows(): RulerRow[] {
    return [0, 1, 2, 3, 4].map((rowIndex) => ({ axisPx: 0, text: `row ${rowIndex}`, eventCount: 1, axisPxList: [0], instants: [buildInstantAtHour(12 - rowIndex)] }));
}

function buildRealRuler(rowsNewestFirst: RulerRow[]): void {
    const ruler = document.createElement("div");
    ruler.id = "timelineRulerComponent";
    document.body.appendChild(ruler);
    for (const row of [...rowsNewestFirst].reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, row);
    }
}

function buildCommitAtHour(hour: number, overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ commitHash: `c${hour}`, instant: buildInstantAtHour(hour), ...overrides });
}

// Changes at rows 1 and 2, born at row 4.
function buildChangedModel(path: string): BarFileModel {
    const commits = [
        buildDiskNowCommit(),
        buildCommitAtHour(11),
        buildCommitAtHour(10, { eventType: "EditRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ];
    const model = buildBarFileModels([buildInverseFile(path, commits)], buildFiveRows())[0];
    assert.ok(model);
    return model;
}

// No change at all, born at the last row.
function buildUnchangedModel(path: string): BarFileModel {
    const model = buildBarFileModels([buildInverseFile(path, [buildDiskNowCommit()])], buildFiveRows())[0];
    assert.ok(model);
    return model;
}

// A page with the real ruler, the given files, and the chunks shown at row 0 (the state after a finished load).
function buildLoadedState(models: BarFileModel[]): BarsViewState {
    initBarsDom();
    buildRealRuler(buildFiveRows());
    const state = createBarsViewState();
    state.rulerRows = listRealRulerRows();
    state.models = models;
    state.selectedRowIndex = 0;
    document.getElementById("barsRows")?.setAttribute("data-blocks", "shown");
    renderBarsRowList(state, false);
    return state;
}

function findRequired(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    assert.ok(found, selector);
    return found;
}

function readBlocksAttribute(): string | null {
    return findRequired("#barsRows").getAttribute("data-blocks");
}

test("test_selecting_a_row_marks_that_real_ruler_tick_selected", () => {
    // Step: a loaded page with five real ruler rows.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    // Step: select row 2 (counted from the newest).
    selectBarsRow(state, 2);
    // Step: exactly one tick is selected, and it is the third from the newest, which is the third from the end in page order.
    const selectedTicks = document.querySelectorAll("#timelineRulerComponent > .tick.barsSelected");
    assert.equal(selectedTicks.length, 1);
    assert.equal(document.querySelectorAll("#timelineRulerComponent > .tick")[2], selectedTicks[0]);
    assert.equal(state.selectedRowIndex, 2);
});

test("test_selecting_a_row_hides_the_chunks", () => {
    // Step: a loaded page whose chunks are shown.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    assert.equal(readBlocksAttribute(), "shown");
    // Step: select a row.
    selectBarsRow(state, 1);
    // Step: the chunks are hidden.
    assert.equal(readBlocksAttribute(), "hidden");
});

test("test_selecting_a_second_row_leaves_the_chunks_hidden", () => {
    // Step: select one row, then another.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    selectBarsRow(state, 1);
    selectBarsRow(state, 3);
    // Step: the chunks stay hidden.
    assert.equal(readBlocksAttribute(), "hidden");
});

test("test_selecting_a_row_sends_the_fill_of_a_changed_file_to_that_row", () => {
    // Step: a changed file that starts at row 0 and is born at row 4.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    // Step: select row 2.
    selectBarsRow(state, 2);
    // Step: the fill covers 2 of the 4 row gaps, which is 50 percent.
    assert.equal(findRequired(".barsFileRow .barsFill").style.width, "50%");
});

test("test_selecting_a_row_moves_the_target_line", () => {
    // Step: a loaded page with one changed file.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    // Step: select row 3 of 5 rows.
    selectBarsRow(state, 3);
    // Step: the target line sits at 3 / 4 of the bar.
    assert.equal(findRequired("#barsTargetLine").style.getPropertyValue("--bars-target-percent"), "75");
});

test("test_selecting_a_row_writes_the_header_and_the_status_text", () => {
    // Step: a loaded page with two files and the read bar showing.
    const state = buildLoadedState([buildChangedModel("a.ts"), buildChangedModel("b.ts")]);
    findRequired("#barsReadBar").removeAttribute("hidden");
    // Step: select row 2.
    selectBarsRow(state, 2);
    // Step: the header names the file count and the row text, the status line names the source, and the read bar hides.
    assert.equal(findRequired("#barsHeaderLine").textContent, "==> Change history of 2 files, back to row 2");
    assert.equal(findRequired("#barsStatusLine").textContent, "==> Read from the inverse repos");
    assert.equal(findRequired("#barsReadBar").hasAttribute("hidden"), true);
});

test("test_selecting_a_row_moves_unchanged_files_under_the_fold_line", () => {
    // Step: a changed file and an unchanged file.
    const state = buildLoadedState([buildChangedModel("changed.ts"), buildUnchangedModel("same.ts")]);
    // Step: select row 2.
    selectBarsRow(state, 2);
    // Step: the unchanged file sits in the folded list under the fold line.
    const foldedPaths = Array.from(document.querySelectorAll(".barsFoldedList > .barsFoldedRow .barsFilePath")).map((pathElement) => pathElement.textContent);
    assert.deepEqual(foldedPaths, ["same.ts"]);
    assert.equal(findRequired(".barsFoldLine").textContent, "==> 1 files with no change since this row [hide]");
});

test("test_selecting_a_row_does_nothing_while_the_history_loads", () => {
    // Step: a loaded page that is still loading.
    const state = buildLoadedState([buildChangedModel("a.ts")]);
    state.isHistoryLoading = true;
    // Step: select row 2.
    selectBarsRow(state, 2);
    // Step: nothing changes: no selected tick, chunks still shown, selected row still 0.
    assert.equal(document.querySelectorAll(".tick.barsSelected").length, 0);
    assert.equal(readBlocksAttribute(), "shown");
    assert.equal(state.selectedRowIndex, 0);
});
