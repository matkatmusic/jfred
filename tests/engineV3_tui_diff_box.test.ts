process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { DiffRowKind } from "../src/structures/vocabulary.ts";
import type { DiffDisplayLine } from "../engineV3/tui/engineV3_tui_diff_display.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { DiffBox } = await import("../engineV3/tui/engineV3_tui_diff_box.tsx");
const { TUI_COLORS } = await import("../engineV3/tui/engineV3_tui_colors.ts");

const GREEN_BACKGROUND_START = "\x1b[42m";
const RED_BACKGROUND_START = "\x1b[41m";
const YELLOW_BACKGROUND_START = "\x1b[43m";
const CYAN_TEXT_START = "\x1b[36m";
const WHITE_TEXT_START = "\x1b[37m";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function drawBox(lines: DiffDisplayLine[], scrollTop: number, rowCount: number, columns: number): string {
    // const props = { lines, scrollTop, rowCount, columns, textColor: "white", lineNumberColor: "gray", newerOnlyBackgroundColor: "green", markerOnlyBackgroundColor: "red", changedBackgroundColor: "yellow" };
    const props = { lines, scrollTop, rowCount, columns, textColor: "white", lineNumberColor: "gray", newerOnlyBackgroundColor: "green", markerOnlyBackgroundColor: "red" };
    return render(createElement(DiffBox, props)).lastFrame()!;
}

function makeLine(kind: DiffRowKind, newerText: string | undefined, markerText: string | undefined, newerNumber: number | undefined, markerNumber: number | undefined, newerColor?: string): DiffDisplayLine {
    return {
        kind,
        newer: { lineNumber: newerNumber, pieces: newerText === undefined ? [] : [{ text: newerText, color: newerColor }] },
        marker: { lineNumber: markerNumber, pieces: markerText === undefined ? [] : [{ text: markerText, color: undefined }] },
    };
}

const LINES: DiffDisplayLine[] = [
    makeLine(DiffRowKind.Same, "same", "same", 1, 1),
    makeLine(DiffRowKind.Changed, "three", "two", 2, 2),
    makeLine(DiffRowKind.OnlyNewer, "added", undefined, 3, undefined),
    makeLine(DiffRowKind.OnlyMarker, undefined, "removed", undefined, 3),
];

test("test_the_two_sides_have_the_titles_newer_and_marker_in_their_top_borders", () => {
    // Scenario: a box of 40 columns holds two sides of 20 columns.
    const topRow = drawBox(LINES, 0, 8, 40).replace(ANSI_PATTERN, "").split("\n")[0]!;
    // the left side top border holds "newer" and the right side top border holds "Marker".
    assert.match(topRow, /^╭─+ newer ─+╮╭─+ Marker ─+╮$/);
    assert.equal(topRow.length, 40);
});

test("test_the_newer_text_is_on_the_left_and_the_marker_text_is_on_the_right_of_one_row", () => {
    // Scenario: a changed row.
    const frame = drawBox(LINES, 0, 8, 40).replace(ANSI_PATTERN, "");
    // the row that holds "three" also holds "two" after it.
    const changedRow = frame.split("\n").find((row) => row.includes("three"))!;
    assert.ok(changedRow.indexOf("three") < changedRow.indexOf("two"));
});

test("test_each_side_shows_its_own_line_number_before_the_text", () => {
    // Scenario: the newer-only row has newer number 3; the marker-only row has marker number 3.
    const rows = drawBox(LINES, 0, 8, 40).replace(ANSI_PATTERN, "").split("\n");
    // the newer-only row starts its text with "3 added" and the marker-only row holds "3 removed".
    assert.ok(rows.find((row) => row.includes("added"))!.includes("3 added"));
    assert.ok(rows.find((row) => row.includes("removed"))!.includes("3 removed"));
});

test("test_changed_only_newer_and_only_marker_rows_have_their_own_background_colors", () => {
    // Scenario: one row of each kind, with the backgrounds green and red.
    const frame = drawBox(LINES, 0, 8, 40);
    // the newer-only side has the green background; the marker-only side has the red background.
    assert.ok(frame.includes(GREEN_BACKGROUND_START));
    assert.ok(frame.includes(RED_BACKGROUND_START));
});

test("test_a_changed_row_is_green_on_the_newer_side_and_red_on_the_marker_side", () => {
    // Scenario: only a changed row shows: the newer text "three" is left, the marker text "two" is right.
    const frame = drawBox([makeLine(DiffRowKind.Changed, "three", "two", 2, 2)], 0, 8, 40);
    const changedRow = frame.split("\n").find((row) => row.includes("three"))!;
    const newerPart = changedRow.slice(0, changedRow.indexOf("three"));
    const markerPart = changedRow.slice(changedRow.indexOf("three"), changedRow.indexOf("two"));
    // the left side has the green background and no red background.
    assert.ok(newerPart.includes(GREEN_BACKGROUND_START));
    assert.ok(!newerPart.includes(RED_BACKGROUND_START));
    // the right side has the red background and no green background.
    assert.ok(markerPart.includes(RED_BACKGROUND_START));
    assert.ok(!markerPart.includes(GREEN_BACKGROUND_START));
    // no side has the old yellow background.
    assert.ok(!changedRow.includes(YELLOW_BACKGROUND_START));
});

test("test_a_same_row_has_no_background", () => {
    // Scenario: only the same row shows.
    const frame = drawBox(LINES.slice(0, 1), 0, 8, 40);
    // no yellow, green or red background starts.
    assert.ok(!frame.includes(YELLOW_BACKGROUND_START));
    assert.ok(!frame.includes(GREEN_BACKGROUND_START));
    assert.ok(!frame.includes(RED_BACKGROUND_START));
});

test("test_a_piece_with_a_token_color_keeps_that_color", () => {
    // Scenario: the newer text has a cyan token.
    const frame = drawBox([makeLine(DiffRowKind.Same, "token", "token", 1, 1, "cyan")], 0, 8, 40);
    // the token text starts with the cyan color.
    assert.ok(frame.includes(`${CYAN_TEXT_START}token`));
});

test("test_a_token_color_is_replaced_by_the_text_color_on_a_row_with_a_background", () => {
    // Scenario: a changed row whose newer text has a cyan token; the text color is white.
    const frame = drawBox([makeLine(DiffRowKind.Changed, "token", "token", 1, 1, "cyan")], 0, 8, 40);
    // the token is drawn in white and not in cyan, so it stays readable on the background.
    assert.ok(frame.includes(`${WHITE_TEXT_START}token`));
    assert.ok(!frame.includes(`${CYAN_TEXT_START}token`));
});

test("test_the_diff_backgrounds_of_the_keymap_are_dark_colors_that_a_256_color_terminal_draws_unchanged", () => {
    // Scenario: the two diff background colors of keymap.json.
    // const backgroundColors = [TUI_COLORS.diffBox.newerOnlyBackgroundColor, TUI_COLORS.diffBox.markerOnlyBackgroundColor, TUI_COLORS.diffBox.changedBackgroundColor];
    const backgroundColors = [TUI_COLORS.diffBox.newerOnlyBackgroundColor, TUI_COLORS.diffBox.markerOnlyBackgroundColor];
    for (const backgroundColor of backgroundColors) {
        const channels = [1, 3, 5].map((start) => parseInt(backgroundColor.slice(start, start + 2), 16));
        // every channel is a level of the 256 color cube, and none is lighter than 0x5f.
        for (const channel of channels) {
            assert.ok([0x00, 0x5f].includes(channel), `${backgroundColor} has the channel ${channel}`);
        }
    }
});

test("test_the_rows_start_at_scrollTop", () => {
    // Scenario: scrollTop 1 hides the first row.
    const frame = drawBox(LINES, 1, 8, 40).replace(ANSI_PATTERN, "");
    // the first row "same" is gone and the changed row shows.
    assert.ok(!frame.includes("same"));
    assert.ok(frame.includes("three"));
});

test("test_a_blank_side_keeps_the_rows_of_both_sides_aligned", () => {
    // Scenario: the newer-only row has a blank right side, the next row holds text on the right only.
    const rows = drawBox(LINES, 0, 8, 40).replace(ANSI_PATTERN, "").split("\n");
    // "added" and "removed" are on consecutive rows, and every row has the full width.
    assert.equal(rows.findIndex((row) => row.includes("removed")) - rows.findIndex((row) => row.includes("added")), 1);
    assert.ok(rows.every((row) => row.length === 40));
});
