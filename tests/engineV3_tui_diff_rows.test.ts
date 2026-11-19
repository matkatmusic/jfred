// The side-by-side diff rows of the View File box: the newer text on the left, the marker text on the right.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DiffRowKind } from "../src/structures/vocabulary.ts";
import { computeDiffRows, computeDiffView } from "../engineV3/tui/engineV3_tui_diff_rows.ts";

test("test_identical_texts_give_only_same_rows", () => {
    // Scenario: both texts hold the lines a and b.
    const rows = computeDiffRows("a\nb\n", "a\nb\n");
    // every row is a same row that holds the line on both sides.
    assert.deepEqual(rows, [
        { kind: DiffRowKind.Same, newerText: "a", markerText: "a" },
        { kind: DiffRowKind.Same, newerText: "b", markerText: "b" },
    ]);
});

test("test_a_changed_line_gives_one_changed_row_with_both_texts", () => {
    // Scenario: the newer text has "three" where the marker text has "two".
    const rows = computeDiffRows("three\nx\n", "two\nx\n");
    // the first row is a changed row: newer text on the left, marker text on the right; the second row is the same row.
    assert.deepEqual(rows, [
        { kind: DiffRowKind.Changed, newerText: "three", markerText: "two" },
        { kind: DiffRowKind.Same, newerText: "x", markerText: "x" },
    ]);
});

test("test_a_line_only_in_the_newer_text_gives_an_only_newer_row", () => {
    // Scenario: the newer text has an extra line "new" in the middle.
    const rows = computeDiffRows("a\nnew\nb\n", "a\nb\n");
    // the middle row holds the line on the left only.
    assert.deepEqual(rows[1], { kind: DiffRowKind.OnlyNewer, newerText: "new", markerText: undefined });
    assert.equal(rows.length, 3);
});

test("test_a_line_only_in_the_marker_text_gives_an_only_marker_row", () => {
    // Scenario: the marker text has an extra line "old" in the middle.
    const rows = computeDiffRows("a\nb\n", "a\nold\nb\n");
    // the middle row holds the line on the right only.
    assert.deepEqual(rows[1], { kind: DiffRowKind.OnlyMarker, newerText: undefined, markerText: "old" });
    assert.equal(rows.length, 3);
});

test("test_a_block_of_two_marker_lines_and_one_newer_line_pairs_the_first_and_leaves_one_alone", () => {
    // Scenario: one newer line "n" replaces the two marker lines "m1" and "m2".
    const rows = computeDiffRows("a\nn\nb\n", "a\nm1\nm2\nb\n");
    // the first pair is a changed row; the second marker line stands alone.
    assert.deepEqual(rows.slice(1, 3), [
        { kind: DiffRowKind.Changed, newerText: "n", markerText: "m1" },
        { kind: DiffRowKind.OnlyMarker, newerText: undefined, markerText: "m2" },
    ]);
});

test("test_a_text_without_a_trailing_newline_gives_the_same_rows_as_with_one", () => {
    // Scenario: the same lines with and without the final newline.
    // both give one same row.
    assert.deepEqual(computeDiffRows("a", "a"), computeDiffRows("a\n", "a\n"));
});

test("test_the_view_of_two_texts_holds_the_rows", () => {
    // Scenario: both texts exist.
    const view = computeDiffView("two\n", "three\n");
    // the rows are the diff of the two texts, the newer text first.
    assert.deepEqual(view.rows, [{ kind: DiffRowKind.Changed, newerText: "three", markerText: "two" }]);
});

test("test_the_view_without_a_newer_text_has_no_rows_and_says_there_is_no_newer_state", () => {
    // Scenario: the marker is at Now, so there is no newer text.
    const view = computeDiffView("two\n", undefined);
    // no rows, and the message names the missing newer state.
    assert.deepEqual(view.rows, []);
    assert.equal(view.emptyText, "no newer state to compare");
});

test("test_the_view_without_a_marker_text_has_no_rows_and_says_there_is_no_stored_text", () => {
    // Scenario: the marker time holds no stored text.
    const view = computeDiffView(undefined, "three\n");
    // no rows, and the message is the plain View File message.
    assert.deepEqual(view.rows, []);
    assert.equal(view.emptyText, "no stored text at this time");
});
