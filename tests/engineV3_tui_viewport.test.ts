// Tests of the terminal UI viewport: which rows of the file list fit on the screen.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getAvailableRowCount, getVisibleRowRange } from "../engineV3/tui/engineV3_tui_viewport.ts";

test("test_viewport_shows_only_the_rows_that_fit", () => {
    // 50 rows, 7 fit on the screen, the cursor is on the first row, the view has not moved.
    const range = getVisibleRowRange(50, 0, 0, 7);
    // The range starts at row 0 and stops before row 7.
    assert.deepEqual(range, { top: 0, bottom: 7 });
});

test("test_viewport_scrolls_when_the_cursor_leaves_the_range", () => {
    // The cursor moves below the range: row 9 with the view at row 0 and 7 rows fitting.
    const rangeAfterMovingDown = getVisibleRowRange(50, 9, 0, 7);
    // The cursor becomes the last visible row: top is 9 - 7 + 1 = 3 and bottom is 10.
    assert.deepEqual(rangeAfterMovingDown, { top: 3, bottom: 10 });
    // The cursor moves above the range: row 4 with the view at row 10.
    const rangeAfterMovingUp = getVisibleRowRange(50, 4, 10, 7);
    // The cursor becomes the first visible row.
    assert.equal(rangeAfterMovingUp.top, 4);
});

test("test_viewport_does_not_move_while_the_cursor_stays_inside", () => {
    // The view is at row 5, 7 rows fit, so rows 5 to 11 show. The cursor is on row 8.
    const range = getVisibleRowRange(50, 8, 5, 7);
    // The view stays at row 5.
    assert.equal(range.top, 5);
});

test("test_getAvailableRowCount_leaves_room_for_the_header_and_two_rows", () => {
    // A terminal with 10 rows: 1 header row, the info row and the menu row are not for files.
    const availableRowCount = getAvailableRowCount(10);
    // 10 - 1 - 2 = 7 rows are left for files.
    assert.equal(availableRowCount, 7);
});
