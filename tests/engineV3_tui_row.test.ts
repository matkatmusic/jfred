import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import type { BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { Row } from "../engineV3/tui/engineV3_tui_row.tsx";

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
