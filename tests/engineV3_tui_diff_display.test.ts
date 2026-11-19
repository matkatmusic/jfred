// The display lines of the side-by-side diff: numbered, wrapped, colored by token, both sides the same height.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DiffRowKind } from "../src/structures/vocabulary.ts";
import { computeDiffDisplay } from "../engineV3/tui/engineV3_tui_diff_display.ts";

const BORDER_COLUMNS = 2;
const NUMBER_GAP_COLUMNS = 1;

test("test_each_side_numbers_its_own_file_lines", () => {
    // Scenario: the newer text has an extra line "new" in the middle; the marker text has a and b.
    const display = computeDiffDisplay("a\nb\n", "a\nnew\nb\n", undefined, 40);
    // the newer side numbers a=1, new=2, b=3; the marker side numbers a=1, blank, b=2.
    assert.deepEqual(display.lines.map((line) => line.newer.lineNumber), [1, 2, 3]);
    assert.deepEqual(display.lines.map((line) => line.marker.lineNumber), [1, undefined, 2]);
});

test("test_a_long_line_wraps_into_more_lines_and_only_the_first_holds_the_number", () => {
    // Scenario: the newer line is 30 letters; each side is 20 columns wide, so the content is 20 - 2 - 1 - 1 = 16 letters wide.
    const longLine = "a".repeat(30);
    const display = computeDiffDisplay("short\n", `${longLine}\n`, undefined, 40);
    // the row becomes two display lines; the newer side numbers the first only.
    assert.equal(display.lines.length, 2);
    assert.deepEqual(display.lines.map((line) => line.newer.lineNumber), [1, undefined]);
    // the marker side pads the second display line with a blank, so both sides stay the same height.
    assert.deepEqual(display.lines.map((line) => line.marker.lineNumber), [1, undefined]);
    assert.deepEqual(display.lines[1]!.marker.pieces, []);
    const contentWidth = 20 - BORDER_COLUMNS - 1 - NUMBER_GAP_COLUMNS;
    assert.equal(display.lines[0]!.newer.pieces.map((piece) => piece.text).join("").length, contentWidth);
});

test("test_the_kind_of_a_row_is_kept_on_every_display_line_of_the_row", () => {
    // Scenario: one changed row that wraps into two display lines.
    const display = computeDiffDisplay("x\n", `${"a".repeat(30)}\n`, undefined, 40);
    // both display lines carry the changed kind.
    assert.deepEqual(display.lines.map((line) => line.kind), [DiffRowKind.Changed, DiffRowKind.Changed]);
});

test("test_a_known_language_gives_the_keyword_a_token_color", () => {
    // Scenario: a typescript line that starts with the keyword "const"; same text on both sides.
    const display = computeDiffDisplay("const a = 1;\n", "const a = 1;\n", "typescript", 80);
    // the first piece of the newer side is "const", with a color.
    const firstPiece = display.lines[0]!.newer.pieces[0]!;
    assert.equal(firstPiece.text, "const");
    assert.notEqual(firstPiece.color, undefined);
});

test("test_an_undefined_language_gives_pieces_without_a_color", () => {
    // Scenario: plain text on both sides.
    const display = computeDiffDisplay("const a = 1;\n", "const a = 1;\n", undefined, 80);
    // the line is one piece without a color.
    assert.deepEqual(display.lines[0]!.newer.pieces, [{ text: "const a = 1;", color: undefined }]);
});

test("test_no_newer_text_gives_no_lines_and_the_no_newer_state_message", () => {
    // Scenario: the marker is at Now.
    const display = computeDiffDisplay("two\n", undefined, undefined, 40);
    // no lines, and the message names the missing newer state.
    assert.deepEqual(display.lines, []);
    assert.equal(display.emptyText, "no newer state to compare");
});
