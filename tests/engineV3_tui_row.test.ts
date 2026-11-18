import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import type { BarDotModel, BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { BarDotKind } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { Row, UNDONE_SO_FAR_COLOR, listBarCells } from "../engineV3/tui/engineV3_tui_row.tsx";
import { buildBarLegendLines } from "../engineV3/tui/engineV3_tui_legend.ts";

const NAME_WIDTH = 10;
const BAR_WIDTH = 20;
const STATE_WIDTH = 12;

function makeEmptyModel(): BarFileModel {
    return { path: "x", startRowIndex: 0, goneMarkKind: undefined, bornRowIndex: 5, isPlusShown: false, commits: [], dots: [], changes: [], marks: [] };
}

function renderRowLine(fileName: string, stateText: string): string {
    const element = createElement(Row, { fileName, model: makeEmptyModel(), status: FileWalkStatus.Idle, markerRowIndex: 0, rulerRowCount: 6, barWidth: BAR_WIDTH, nameWidth: NAME_WIDTH, stateWidth: STATE_WIDTH, isCursor: false, isSelected: false, stateText });
    return render(element).lastFrame()!;
}

test("test_a_file_name_longer_than_the_name_column_is_cut_with_an_ellipsis", () => {
    // Scenario: the name column is 10 columns and the file name has 27 characters.
    const line = renderRowLine("very_long_file_name_here.ts", "same as now");
    // The line shows an ellipsis and not the whole name.
    assert.ok(line.includes("…"));
    assert.ok(!line.includes("very_long_file_name_here.ts"));
});

test("test_the_bar_starts_in_the_same_column_for_a_short_name_and_a_long_name", () => {
    // Scenario: one row with a short name, one row with a long name.
    const shortLine = renderRowLine("a.ts", "same as now");
    const longLine = renderRowLine("very_long_file_name_here.ts", "same as now");
    // The first bar character is in the same column in both lines.
    assert.equal(shortLine.search(/[─█]/), longLine.search(/[─█]/));
});

test("test_the_status_text_starts_in_the_same_column_for_a_short_name_and_a_long_name", () => {
    // Scenario: one row with a short name, one row with a long name.
    const shortLine = renderRowLine("a.ts", "same as now");
    const longLine = renderRowLine("very_long_file_name_here.ts", "same as now");
    // The status text is in the same column in both lines.
    assert.equal(shortLine.indexOf("same as now"), longLine.indexOf("same as now"));
});

test("test_the_undone_so_far_bar_cells_have_the_same_color_as_the_legend_entry", () => {
    // Scenario: the legend draws "undone so far" in one color, and the bar cells of the same part must use that color.
    // The bar cells of a model with a filled part.
    const cells = listBarCells(makeEmptyModel(), 3, 6, BAR_WIDTH);
    const undoneSoFarCells = cells.filter((cell) => cell.character === "█");
    assert.ok(undoneSoFarCells.length > 0);
    // The legend entry for "undone so far".
    const legendEntry = buildBarLegendLines().flat().find((entry) => entry.label === "█")!;
    // The legend entry has a color.
    assert.notEqual(legendEntry.labelColor, undefined);
    // Every "█" cell has the color of the legend entry.
    for (const cell of undoneSoFarCells) {
        assert.equal(cell.color, legendEntry.labelColor);
    }
});

function makeDot(rowIndex: number, alpha: number): BarDotModel {
    return { commitIndex: 0, commitHash: "h", rowIndex, kind: BarDotKind.edit, stageIndex: 0, alpha, instant: null } as BarDotModel;
}

// 6 ruler rows and 20 bar cells: row 1 is cell 4, row 2 is cell 8, row 3 is cell 11, row 5 is cell 19 (the marker).
function listFilledCellCharacters(dots: BarDotModel[]): string[] {
    return listBarCells({ ...makeEmptyModel(), dots }, 5, 6, BAR_WIDTH).map((cell) => cell.character);
}

test("test_a_filled_part_with_a_proven_dot_shows_full_boxes", () => {
    // Scenario: one proven dot (alpha 1) at cell 8; the fill reaches the marker at cell 19.
    const characters = listFilledCellCharacters([makeDot(2, 1)]);
    // The cell before the dot and the cell after the dot are full boxes.
    assert.equal(characters[1], "█");
    assert.equal(characters[12], "█");
});

test("test_a_filled_part_with_a_confirmed_dot_shows_dark_shaded_boxes", () => {
    // Scenario: one confirmed dot (alpha 0.75) at cell 8.
    const characters = listFilledCellCharacters([makeDot(2, 0.75)]);
    // The cell before the dot and the cell after the dot are dark shaded boxes.
    assert.equal(characters[1], "▓");
    assert.equal(characters[12], "▓");
});

test("test_a_filled_part_with_a_derived_dot_shows_light_shaded_boxes", () => {
    // Scenario: one derived dot (alpha 0.4) at cell 8.
    const characters = listFilledCellCharacters([makeDot(2, 0.4)]);
    // The cell before the dot and the cell after the dot are light shaded boxes.
    assert.equal(characters[1], "▒");
    assert.equal(characters[12], "▒");
});

test("test_a_filled_part_takes_the_shade_of_the_next_dot_and_after_the_last_dot_the_last_shade", () => {
    // Scenario: a proven dot at cell 4 and a derived dot at cell 11.
    const characters = listFilledCellCharacters([makeDot(1, 1), makeDot(3, 0.4)]);
    // A cell before the first dot takes the shade of the first dot.
    assert.equal(characters[2], "█");
    // A cell between the two dots takes the shade of the second dot.
    assert.equal(characters[8], "▒");
    // A cell after the last dot takes the shade of the last dot.
    assert.equal(characters[15], "▒");
});

test("test_the_shaded_boxes_have_the_undone_so_far_color", () => {
    // Scenario: a derived dot at cell 8.
    const cells = listBarCells({ ...makeEmptyModel(), dots: [makeDot(2, 0.4)] }, 5, 6, BAR_WIDTH);
    // The shaded cell before the dot has the undone so far color.
    assert.equal(cells[1]!.character, "▒");
    assert.equal(cells[1]!.color, UNDONE_SO_FAR_COLOR);
});
