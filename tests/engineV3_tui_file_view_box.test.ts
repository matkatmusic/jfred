process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { FileViewLine } from "../engineV3/tui/engineV3_tui_file_view_text.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { FileViewBox } = await import("../engineV3/tui/engineV3_tui_file_view_box.tsx");

const CYAN_START = "\x1b[36m";
const GREEN_START = "\x1b[32m";
const RED_START = "\x1b[31m";
const COLOR_CODE_PATTERN = /\x1b\[[0-9;]*m/g;
const COLUMNS = 20;
const EMPTY_TEXT = "no stored state at this time";

function makeTwelveLines(): FileViewLine[] {
    return Array.from({ length: 12 }, (_, index) => ({ lineNumber: index + 1, pieces: [{ text: `line ${index + 1}`, color: undefined }] }));
}

function drawBox(lines: FileViewLine[], scrollTop: number, rowCount: number, emptyText: string = EMPTY_TEXT): string {
    const { lastFrame } = render(createElement(FileViewBox, { fileName: "a.ts", lines, scrollTop, rowCount, columns: COLUMNS, lineNumberColor: "cyan", textColor: "green", emptyText }));
    return lastFrame()!;
}

test("test_the_box_shows_lines_from_scroll_top_with_right_aligned_numbers", () => {
    // Scenario: 12 lines, a box of 6 rows holds 4 lines between its borders, scroll top 8.
    const frame = drawBox(makeTwelveLines(), 8, 6).replace(COLOR_CODE_PATTERN, "");
    // the lines 9 to 12 show, each after its right-aligned number.
    assert.ok(frame.includes(" 9 line 9"));
    assert.ok(frame.includes("12 line 12"));
    // the line 8 above the scroll top does not show.
    assert.ok(!frame.includes("line 8"));
});

test("test_the_box_is_as_wide_and_as_high_as_asked", () => {
    // Scenario: columns 20, 6 rows.
    const frameLines = drawBox(makeTwelveLines(), 0, 6).replace(COLOR_CODE_PATTERN, "").split("\n");
    // 6 rows, borders included.
    assert.equal(frameLines.length, 6);
    // every row is 20 columns wide.
    assert.deepEqual(frameLines.map((frameLine) => frameLine.length), [20, 20, 20, 20, 20, 20]);
});

test("test_the_box_shows_the_empty_text_when_there_are_no_lines", () => {
    // Scenario: no lines.
    const frame = drawBox([], 0, 6, "none");
    // the empty text shows.
    assert.ok(frame.includes("none"));
});

test("test_the_box_colors_the_numbers_and_the_text_with_the_given_colors", () => {
    // Scenario: number color cyan, text color green.
    const frame = drawBox(makeTwelveLines(), 0, 6);
    // the frame holds both color codes.
    assert.ok(frame.includes(CYAN_START));
    assert.ok(frame.includes(GREEN_START));
});

test("test_a_wrapped_display_line_has_a_blank_number_column", () => {
    // Scenario: a line number 1 followed by its wrapped piece without a number.
    const frame = drawBox([{ lineNumber: 1, pieces: [{ text: "abcd", color: undefined }] }, { lineNumber: undefined, pieces: [{ text: "efgh", color: undefined }] }], 0, 4).replace(COLOR_CODE_PATTERN, "");
    // the wrapped piece sits in the text column under the first piece.
    assert.ok(frame.includes("1 abcd"));
    assert.ok(frame.includes("  efgh"));
});

test("test_the_box_draws_each_piece_in_its_own_color_and_a_piece_without_color_in_the_text_color", () => {
    // Scenario: one line of a red piece "ab" and a piece "cd" without a color; the text color is green.
    const frame = drawBox([{ lineNumber: 1, pieces: [{ text: "ab", color: "red" }, { text: "cd", color: undefined }] }], 0, 4);
    // the red piece has the red code, and the piece without color has the green code.
    assert.ok(frame.includes(`${RED_START}ab`));
    assert.ok(frame.includes(`${GREEN_START}cd`));
});
