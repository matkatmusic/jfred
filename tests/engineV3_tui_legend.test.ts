import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { buildBarLegendLines } from "../engineV3/tui/engineV3_tui_legend.ts";
import { LegendBox } from "../engineV3/tui/engineV3_tui_footer.tsx";

test("test_the_legend_is_split_into_3_rows", () => {
    // Scenario: build the legend lines.
    const lines = buildBarLegendLines();
    // There are 3 lines.
    assert.equal(lines.length, 3);
});

test("test_each_legend_row_starts_with_its_row_name", () => {
    // Scenario: build the legend lines.
    const lines = buildBarLegendLines();
    // The first entry of each line is the row name: Events, File, Bar.
    assert.deepEqual(lines.map((line) => line[0]!.label), ["Events", "File", "Bar"]);
});

test("test_the_file_row_explains_born_removed_and_moved_away", () => {
    // Scenario: build the legend lines.
    const fileRow = buildBarLegendLines()[1]!;
    // After the row name come the three file marks and their short meaning.
    assert.deepEqual(fileRow.slice(1, 4), [{ label: "+", value: "born" }, { label: "-", value: "removed" }, { label: "←", value: "moved away" }]);
});

test("test_the_file_row_explains_the_walk_marks_left_of_the_bars", () => {
    // Scenario: build the legend lines.
    const fileRow = buildBarLegendLines()[1]!;
    // After the three file marks come the four walk marks of ROW_MARKS: walked, stopped, crashed, walking.
    assert.deepEqual(fileRow.slice(4), [{ label: "✔", value: "walked" }, { label: "!", value: "stopped" }, { label: "x", value: "crashed" }, { label: "⠿", value: "walking" }]);
});

test("test_the_legend_box_with_the_walk_marks_still_has_3_text_rows_at_100_columns", () => {
    // Scenario: render the legend box on the 100 column screen of the app tests.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 100 })).lastFrame()!;
    // The frame has 5 rows: no line wraps.
    assert.equal(frame.split("\n").length, 5);
});

test("test_the_bar_row_explains_lifetime_marker_undone_and_confidence", () => {
    // Scenario: build the legend lines.
    const barRow = buildBarLegendLines()[2]!;
    // After the row name come the four bar symbols and their meaning, the colored ones in the undone color.
    assert.deepEqual(barRow.slice(1).map((entry) => [entry.label, entry.value]), [
        ["─", "file's lifetime in project"],
        ["│", "time marker"],
        ["█", "undone so far"],
        ["█▓▒", "confidence (proven, confirmed, derived)"],
    ]);
});

test("test_the_legend_box_with_3_lines_is_5_rows_tall", () => {
    // Scenario: render the legend box on a 120 column screen.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 120 })).lastFrame()!;
    // The frame has 5 rows: 3 text rows and the top and bottom border.
    assert.equal(frame.split("\n").length, 5);
});

test("test_the_legend_has_one_entry_for_each_bar_symbol", () => {
    // Scenario: build the legend entries.
    const entries = buildBarLegendLines().flat();
    // Every symbol that a bar can show has an entry.
    const labels = entries.map((entry) => entry.label);
    for (const symbol of ["─", "█", "│", "+", "-", "←", "●"]) {
        assert.ok(labels.includes(symbol), `missing the symbol ${symbol}`);
    }
});

// test("test_the_dot_entry_names_each_dot_color_with_its_meaning", () => {
//     // Scenario: build the legend entries.
//     const dotEntry = buildBarLegendLines().flat().find((entry) => entry.label === "●")!;
//     // The value pairs each color with the dot kind from the web page.
//     assert.ok(dotEntry.value.includes("blue commit"));
//     assert.ok(dotEntry.value.includes("green snapshot"));
//     assert.ok(dotEntry.value.includes("gray read"));
//     assert.ok(dotEntry.value.includes("magenta script run"));
// });

test("test_the_legend_box_shows_the_symbols_and_their_meaning", () => {
    // Scenario: render the legend box on a 120 column screen.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 120 })).lastFrame()!;
    // The frame shows a symbol and its meaning text.
    assert.ok(frame.includes("█"));
    assert.ok(frame.includes("time marker"));
});

test("test_a_legend_line_wider_than_the_box_cuts_only_its_last_entry", () => {
    // Scenario: render the legend box on a 100 column screen; the bar row needs 116 columns.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 100 })).lastFrame()!;
    // The entries before the last one stay whole.
    for (const wholeText of ["file's lifetime in project", "time marker", "undone so far"]) {
        assert.ok(frame.includes(wholeText), `cut: ${wholeText}`);
    }
    // The last entry is cut with an ellipsis, and the box is still 5 rows.
    assert.ok(!frame.includes("confidence (proven, confirmed, derived)"));
    assert.equal(frame.split("\n").length, 5);
});

test("test_the_legend_box_shows_the_three_row_names", () => {
    // Scenario: render the legend box on a 120 column screen.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 120 })).lastFrame()!;
    // The frame shows each row name followed by a colon.
    for (const rowName of ["Events:", "File:", "Bar:"]) {
        assert.ok(frame.includes(rowName), `missing ${rowName}`);
    }
});
