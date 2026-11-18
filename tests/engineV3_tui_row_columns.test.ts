import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRowColumnWidths, ROW_PREFIX_WIDTH, ROW_MARK_WIDTH, ROW_STATE_WIDTH, ROW_GAP_COUNT } from "../engineV3/tui/engineV3_tui_row_columns.ts";

const TERMINAL_COLUMNS = 100;

test("test_the_name_column_is_cut_to_30_percent_of_the_screen_for_long_names", () => {
    // Scenario: the longest file name has 80 characters, the screen has 100 columns.
    const widths = computeRowColumnWidths(TERMINAL_COLUMNS, 80);
    // The name column is 30 columns: 30 percent of the screen.
    assert.equal(widths.nameWidth, 30);
});

test("test_the_name_column_is_as_wide_as_the_longest_name_when_all_names_are_short", () => {
    // Scenario: the longest file name has 12 characters.
    const widths = computeRowColumnWidths(TERMINAL_COLUMNS, 12);
    // The name column is 12 columns.
    assert.equal(widths.nameWidth, 12);
});

test("test_the_row_columns_and_gaps_fill_the_screen_exactly", () => {
    // Scenario: a long name and a 100 column screen.
    const widths = computeRowColumnWidths(TERMINAL_COLUMNS, 80);
    // The five columns plus the gaps between them equal the screen width, so the status text ends at the right edge.
    const total = ROW_PREFIX_WIDTH + widths.nameWidth + ROW_MARK_WIDTH + widths.barWidth + ROW_STATE_WIDTH + ROW_GAP_COUNT;
    assert.equal(total, TERMINAL_COLUMNS);
});

test("test_the_bar_column_is_the_same_for_every_row", () => {
    // Scenario: two different longest-name lengths that are both above the cut.
    const shortList = computeRowColumnWidths(TERMINAL_COLUMNS, 60);
    const longList = computeRowColumnWidths(TERMINAL_COLUMNS, 200);
    // Both give the same bar width: the bar width depends on the screen, not on one name.
    assert.equal(shortList.barWidth, longList.barWidth);
});
