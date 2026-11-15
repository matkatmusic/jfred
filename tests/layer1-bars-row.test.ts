import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BarRowMark,
    buildModelBarRow,
    buildStreamBarRow,
    revealBarsHistoryStage,
    setBarRowFillPercent,
    setBarRowMark,
    setBarRowRightText,
    type BarModelRowOptions,
    type BarRowElements,
} from "../webapp/layer1-components/bars-view/layer1-bars-row.ts";
import type { BarDotModel, BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { BarMarkKind } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { BarDotKind } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { ShowRowKind } from "../webapp/layer1-components/show-row/layer1-show-row.ts";
import { buildInverseCommit, initBarsDom } from "./layer1-bars-test-helpers.ts";

const FILE_INDEX = 3;

// Five rows: a row index i sits at i * 25 percent.
function buildFiveRulerRows(): RulerRow[] {
    const rows: RulerRow[] = [];
    for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
        rows.push({ axisPx: 0, text: `row${rowIndex}`, eventCount: 1, axisPxList: [0], instants: ["2026-11-13T08:00:00.000Z"] });
    }
    return rows;
}

function buildDot(overrides: Partial<BarDotModel>): BarDotModel {
    return {
        commitIndex: 0,
        commitHash: "c0",
        rowIndex: 0,
        kind: BarDotKind.commit,
        group: ShowRowKind.commit,
        stageIndex: 1,
        alpha: 1,
        instant: null,
        ...overrides,
    };
}

function buildModel(overrides: Partial<BarFileModel>): BarFileModel {
    return {
        path: "src/a.ts",
        startRowIndex: 0,
        goneMarkKind: undefined,
        bornRowIndex: 4,
        isPlusShown: false,
        commits: [buildInverseCommit()],
        dots: [],
        changes: [],
        marks: [],
        ...overrides,
    };
}

function buildOptions(overrides: Partial<BarModelRowOptions> = {}): BarModelRowOptions {
    return { selectedRowIndex: 0, isPlaceholder: false, isFolded: false, rightText: "same as now", ...overrides };
}

function buildRow(model: BarFileModel, options: BarModelRowOptions = buildOptions()): BarRowElements {
    return buildModelBarRow(model, FILE_INDEX, buildFiveRulerRows(), options);
}

function listByClass(row: BarRowElements, className: string): HTMLElement[] {
    return Array.from(row.rowElement.querySelectorAll<HTMLElement>("." + className));
}

function findOneByClass(row: BarRowElements, className: string): HTMLElement {
    const found = listByClass(row, className);
    assert.equal(found.length, 1, className);
    return found[0] as HTMLElement;
}

test("test_a_stream_row_shows_the_path_a_waiting_mark_and_the_text_waiting", () => {
    // Scenario: a file seen only in the stream gets a bare row.
    initBarsDom();
    // Build the stream row for one path.
    const row = buildStreamBarRow("src/stream.ts");
    // The path text and title are the path.
    assert.equal(row.pathElement.textContent, "src/stream.ts");
    assert.equal(row.pathElement.title, "src/stream.ts");
    // The mark is waiting.
    assert.equal(row.markElement.className, "barsMark waiting");
    // The right column says waiting.
    assert.equal(row.rightElement.textContent, "waiting");
    // The bar is full width, the fill is empty, and there are no dots, chunks or target.
    assert.equal(row.progressBarElement.style.left, "0%");
    assert.equal(row.progressBarElement.style.width, "100%");
    assert.equal(row.fillElement.style.width, "0%");
    // assert.equal(row.targetElement, undefined);
    assert.equal(listByClass(row, "BarDot").length, 0);
    assert.equal(listByClass(row, "barsHistoryBlock").length, 0);
    assert.equal(row.rowElement.dataset.component, "barsFileRow");
});

test("test_setting_the_mark_changes_the_mark_class", () => {
    // Scenario: setBarRowMark replaces the state word on the mark.
    initBarsDom();
    const row = buildStreamBarRow("src/a.ts");
    // Set the mark to running, then done.
    setBarRowMark(row, BarRowMark.running);
    assert.equal(row.markElement.className, "barsMark running");
    setBarRowMark(row, BarRowMark.done);
    assert.equal(row.markElement.className, "barsMark done");
});

test("test_setting_the_fill_percent_sets_the_fill_width", () => {
    // Scenario: setBarRowFillPercent sets the fill width in percent.
    initBarsDom();
    const row = buildStreamBarRow("src/a.ts");
    setBarRowFillPercent(row, 42.5);
    assert.equal(row.fillElement.style.width, "42.5%");
});

test("test_setting_the_right_text_changes_the_right_column", () => {
    // Scenario: setBarRowRightText replaces the right column text.
    initBarsDom();
    const row = buildStreamBarRow("src/a.ts");
    setBarRowRightText(row, "step 2 of 5");
    assert.equal(row.rightElement.textContent, "step 2 of 5");
});

test("test_a_model_row_has_one_dot_per_dot_at_its_percent", () => {
    // Scenario: every dot of the model becomes one BarDot at its row percent, with the label and row text as title.
    initBarsDom();
    const model = buildModel({ dots: [buildDot({ rowIndex: 1 }), buildDot({ rowIndex: 3, kind: BarDotKind.disk, group: ShowRowKind.disk })] });
    const dots = listByClass(buildRow(model), "BarDot");
    assert.equal(dots.length, 2);
    assert.equal(dots[0]?.style.left, "25%");
    assert.equal(dots[1]?.style.left, "75%");
    assert.equal(dots[0]?.title, "commit  row1");
    assert.equal(dots[1]?.title, "disk now  row3");
    assert.equal(dots[0]?.dataset.component, "BarDot");
    assert.equal(dots[0]?.parentElement?.className, "barsDotStrip");
});

test("test_a_dot_has_its_kind_and_group_classes_and_its_indexes", () => {
    // Scenario: a dot carries bd-<kind>, grp-<group> and its three data attributes.
    initBarsDom();
    const model = buildModel({ dots: [buildDot({}), buildDot({ kind: BarDotKind.script, group: ShowRowKind.scriptRun, stageIndex: 5 })] });
    const dots = listByClass(buildRow(model), "BarDot");
    assert.equal(dots[1]?.className, "BarDot bd-script grp-script-run");
    assert.equal(dots[1]?.dataset.fileIndex, String(FILE_INDEX));
    assert.equal(dots[1]?.dataset.dotIndex, "1");
    assert.equal(dots[1]?.dataset.stageIndex, "5");
    assert.equal(dots[0]?.dataset.dotIndex, "0");
});

test("test_a_placeholder_row_marks_every_dot_as_a_placeholder", () => {
    // Scenario: during the history load every dot has dotPlaceholder, and after it none has.
    initBarsDom();
    const model = buildModel({ dots: [buildDot({}), buildDot({ rowIndex: 2 })] });
    const placeholderDots = listByClass(buildRow(model, buildOptions({ isPlaceholder: true })), "BarDot");
    assert.equal(placeholderDots.every((dot) => dot.classList.contains("dotPlaceholder")), true);
    const plainDots = listByClass(buildRow(model, buildOptions({ isPlaceholder: false })), "BarDot");
    assert.equal(plainDots.some((dot) => dot.classList.contains("dotPlaceholder")), false);
});

test("test_a_model_row_has_one_chunk_per_change_with_the_alpha_as_opacity", () => {
    // Scenario: every change becomes one chunk with its kind class, opacity, stage index and title.
    initBarsDom();
    const changes = [
        buildDot({ rowIndex: 1, kind: BarDotKind.edit, group: ShowRowKind.edit, stageIndex: 4, alpha: 0.75 }),
        buildDot({ rowIndex: 2, kind: BarDotKind.write, alpha: 0.4 }),
    ];
    const chunks = listByClass(buildRow(buildModel({ changes })), "barsHistoryBlock");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.className, "barsHistoryBlock hb-edit");
    assert.equal(chunks[0]?.style.getPropertyValue("--blockOpacity"), "0.75");
    assert.equal(chunks[1]?.style.getPropertyValue("--blockOpacity"), "0.4");
    assert.equal(chunks[0]?.dataset.stageIndex, "4");
    assert.equal(chunks[0]?.title, "edit  row1  bytes known: 75%");
    assert.equal(chunks[0]?.dataset.component, "barsHistoryBlock");
});

test("test_the_bar_ends_at_the_born_row_percent", () => {
    // Scenario: a file born at row 2 of 5 has a bar from 0% that is 50% wide.
    initBarsDom();
    const row = buildRow(buildModel({ bornRowIndex: 2 }));
    assert.equal(row.progressBarElement.style.left, "0%");
    assert.equal(row.progressBarElement.style.width, "50%");
    assert.equal(row.progressBarElement.className, "FileReconstructionProgressBar");
    assert.equal(row.progressBarElement.parentElement?.className, "ProjectLifetimeBar");
    assert.equal(row.fillElement.style.width, "0%");
});

test("test_the_bar_of_a_file_gone_now_starts_at_its_start_row_percent", () => {
    // Scenario: a file gone at row 1 and born at row 3 has a bar from 25% that is 50% wide.
    initBarsDom();
    const row = buildRow(buildModel({ startRowIndex: 1, bornRowIndex: 3 }));
    assert.equal(row.progressBarElement.style.left, "25%");
    assert.equal(row.progressBarElement.style.width, "50%");
});

test("test_a_chunk_of_a_file_gone_now_sits_relative_to_its_start_row", () => {
    // Scenario: start 1, born 3 gives barSpanRows 2: a chunk at row 2 sits at 50% and is 50% wide.
    initBarsDom();
    const changes = [buildDot({ rowIndex: 2, kind: BarDotKind.edit, group: ShowRowKind.edit })];
    const chunk = findOneByClass(buildRow(buildModel({ startRowIndex: 1, bornRowIndex: 3, changes })), "barsHistoryBlock");
    assert.equal(chunk.style.left, "50%");
    assert.equal(chunk.style.width, "50%");
    // Scenario: start equals born gives barSpanRows 1, so no division by zero.
    const sameRowChunk = findOneByClass(buildRow(buildModel({ startRowIndex: 3, bornRowIndex: 3, changes: [buildDot({ rowIndex: 3 })] })), "barsHistoryBlock");
    assert.equal(sameRowChunk.style.left, "0%");
    assert.equal(sameRowChunk.style.width, "100%");
});

test("test_the_plus_sign_shows_only_when_the_model_says_so", () => {
    // Scenario: the plus sign sits at the born row percent when isPlusShown, else it is absent.
    initBarsDom();
    const shownRow = buildRow(buildModel({ bornRowIndex: 2, isPlusShown: true }));
    const plusSign = findOneByClass(shownRow, "barsPlusSign");
    assert.equal(plusSign.textContent, "+");
    assert.equal(plusSign.style.left, "50%");
    assert.equal(plusSign.parentElement?.className, "ProjectLifetimeBar");
    assert.equal(plusSign.dataset.component, "barsPlusSign");
    assert.equal(listByClass(buildRow(buildModel({ isPlusShown: false })), "barsPlusSign").length, 0);
});

test("test_a_removed_mark_shows_a_minus_sign_at_its_row_percent", () => {
    // Scenario: a removed mark at row 1 draws "-" at 25% with the title "removed  row1".
    initBarsDom();
    const marks = [{ kind: BarMarkKind.removed, rowIndex: 1, movedAwayTo: null }];
    const minusSign = findOneByClass(buildRow(buildModel({ marks })), "barsMinusSign");
    assert.equal(minusSign.textContent, "-");
    assert.equal(minusSign.style.left, "25%");
    assert.equal(minusSign.title, "removed  row1");
    assert.equal(minusSign.dataset.component, "barsMinusSign");
    assert.equal(minusSign.parentElement?.className, "ProjectLifetimeBar");
});

test("test_a_moved_away_mark_shows_a_left_arrow_at_its_row_percent", () => {
    // Scenario: a movedAway mark at row 3 draws "←" at 75%, and no minus sign.
    initBarsDom();
    const marks = [{ kind: BarMarkKind.movedAway, rowIndex: 3, movedAwayTo: "/p/b.ts" }];
    const row = buildRow(buildModel({ marks }));
    const arrowSign = findOneByClass(row, "barsMovedAwaySign");
    assert.equal(arrowSign.textContent, "←");
    assert.equal(arrowSign.style.left, "75%");
    assert.equal(arrowSign.dataset.component, "barsMovedAwaySign");
    assert.equal(listByClass(row, "barsMinusSign").length, 0);
});

test("test_a_moved_away_mark_title_names_the_destination", () => {
    // Scenario: the arrow title reads "moved away to <destination>  <row text>".
    initBarsDom();
    const marks = [{ kind: BarMarkKind.movedAway, rowIndex: 3, movedAwayTo: "/p/b.ts" }];
    const arrowSign = findOneByClass(buildRow(buildModel({ marks })), "barsMovedAwaySign");
    assert.equal(arrowSign.title, "moved away to /p/b.ts  row3");
});

test("test_a_model_with_no_marks_has_no_minus_sign_and_no_arrow_sign", () => {
    // Scenario: with no marks, neither sign exists.
    initBarsDom();
    const row = buildRow(buildModel({ marks: [] }));
    assert.equal(listByClass(row, "barsMinusSign").length, 0);
    assert.equal(listByClass(row, "barsMovedAwaySign").length, 0);
});

test("test_a_model_row_has_no_target_line_of_its_own", () => {
    // Scenario: the selected-time line is one line for the whole list, so a row holds none.
    initBarsDom();
    const row = buildRow(buildModel({}), buildOptions({ selectedRowIndex: 3 }));
    assert.equal(listByClass(row, "barsTargetSegment").length, 0);
});

test("test_a_folded_row_has_the_folded_class", () => {
    // Scenario: a folded row has barsFoldedRow, a waiting mark and the right text; an open row has the done mark.
    initBarsDom();
    const foldedRow = buildRow(buildModel({}), buildOptions({ isFolded: true, rightText: "deleted, not restored yet" }));
    assert.equal(foldedRow.rowElement.className, "barsFileRow barsFoldedRow");
    assert.equal(foldedRow.markElement.className, "barsMark waiting");
    assert.equal(foldedRow.rightElement.textContent, "deleted, not restored yet");
    assert.equal(foldedRow.pathElement.dataset.fileIndex, String(FILE_INDEX));
    const openRow = buildRow(buildModel({}));
    assert.equal(openRow.rowElement.className, "barsFileRow");
    assert.equal(openRow.markElement.className, "barsMark done");
});

test("test_revealing_a_stage_removes_the_placeholder_of_its_dots_only", () => {
    // Scenario: revealing stage 2 clears dotPlaceholder from dots of stage 2 and leaves the dots of stage 3.
    initBarsDom();
    const model = buildModel({ dots: [buildDot({ stageIndex: 2 }), buildDot({ stageIndex: 3, rowIndex: 1 })] });
    const row = buildRow(model, buildOptions({ isPlaceholder: true }));
    const rowListElement = document.getElementById("barsRowList") as HTMLElement;
    rowListElement.appendChild(row.rowElement);
    revealBarsHistoryStage(rowListElement, 2);
    const dots = listByClass(row, "BarDot");
    assert.equal(dots[0]?.classList.contains("dotPlaceholder"), false);
    assert.equal(dots[1]?.classList.contains("dotPlaceholder"), true);
});

test("test_revealing_a_stage_marks_the_chunks_of_that_stage_as_revealed", () => {
    // Scenario: revealing stage 4 adds blockRevealed to chunks of stage 4 only.
    initBarsDom();
    const changes = [buildDot({ stageIndex: 4, rowIndex: 1 }), buildDot({ stageIndex: 5, rowIndex: 2 })];
    const row = buildRow(buildModel({ changes }));
    const rowListElement = document.getElementById("barsRowList") as HTMLElement;
    rowListElement.appendChild(row.rowElement);
    revealBarsHistoryStage(rowListElement, 4);
    const chunks = listByClass(row, "barsHistoryBlock");
    assert.equal(chunks[0]?.classList.contains("blockRevealed"), true);
    assert.equal(chunks[1]?.classList.contains("blockRevealed"), false);
});
