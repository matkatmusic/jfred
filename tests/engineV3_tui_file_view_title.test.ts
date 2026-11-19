// The title of the View File box: the file name and the range of file lines on screen.

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFileViewTitle } from "../engineV3/tui/engineV3_tui_file_view_title.ts";
import type { FileViewLine } from "../engineV3/tui/engineV3_tui_file_view_text.ts";

function makeRow(lineNumber: number | undefined): FileViewLine {
    return { lineNumber, pieces: [{ text: "x", color: undefined }] };
}

test("test_the_title_names_the_file_and_the_range_of_file_lines_on_screen", () => {
    // Scenario: 5 rows numbered 1 to 5; the window starts at row 1 and shows 3 rows.
    const rows = [1, 2, 3, 4, 5].map(makeRow);
    // rows 2, 3 and 4 show.
    assert.equal(describeFileViewTitle("feederGeometry.ts", rows, 1, 3), "feederGeometry.ts | showing 2-4 of 5 lines");
});

test("test_a_wrapped_line_counts_once_and_the_range_uses_the_file_line_of_each_edge_row", () => {
    // Scenario: file line 1 is 1 row, line 2 wraps to 3 rows, line 3 is 1 row.
    const rows = [makeRow(1), makeRow(2), makeRow(undefined), makeRow(undefined), makeRow(3)];
    // the window starts on a continuation row of line 2 and shows 2 rows: rows 2 and 3 belong to line 2.
    assert.equal(describeFileViewTitle("a.ts", rows, 2, 2), "a.ts | showing 2-2 of 3 lines");
    // the window starts at row 3 and shows 5 rows (more than remain): the last row is line 3.
    assert.equal(describeFileViewTitle("a.ts", rows, 3, 5), "a.ts | showing 2-3 of 3 lines");
});

test("test_a_file_without_rows_shows_zero_of_zero", () => {
    assert.equal(describeFileViewTitle("a.ts", [], 0, 10), "a.ts | showing 0-0 of 0 lines");
});
