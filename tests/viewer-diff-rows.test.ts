// Tests for the diff-vs-base view models (webapp/views/diff-vs-base-model.ts — plain ES module,
// DOM-free): split (side-by-side) rows, inline rows, and the stored display-mode toggle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInlineRows, computeSplitRows, DiffDisplayMode, resolveInitialDiffDisplayMode, SplitRowKind } from "../webapp/views/diff-vs-base-model.ts";

// -------------------- split (side-by-side) diff rows --------------------

test("test_computeSplitRows_renders_context_line_in_both_columns", () => {
    // Scenario: inside a hunk, a context line shows the same text on the left and right, uncolored.
    // Steps:
    // split a one-hunk diff holding a single context line.
    const rows = computeSplitRows("@@ -1,3 +1,3 @@\n unchanged");
    // the hunk header is a full-width row with the hunk color class.
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ -1,3 +1,3 @@", lineClass: "diff-line-hunk" });
    // the context line pairs identical uncolored cells (unified " " prefix stripped), each
    // numbered from its side of the "@@ -1,3 +1,3 @@" header.
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "unchanged", lineClass: "", lineNumber: 1 },
        right: { text: "unchanged", lineClass: "", lineNumber: 1 },
    });
});

test("test_computeSplitRows_zips_equal_deletion_and_addition_runs", () => {
    // Scenario: a run of "-" lines followed by a run of "+" lines pairs row-by-row: deletion i on
    // the left (red), addition i on the right (green).
    // Steps:
    // split a hunk holding two deletions then two additions.
    const rows = computeSplitRows("@@ -1,2 +1,2 @@\n-old1\n-old2\n+new1\n+new2");
    // row 1 pairs the first deletion with the first addition, numbered per side.
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "old1", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "new1", lineClass: "diff-line-add", lineNumber: 1 },
    });
    // row 2 pairs the second deletion with the second addition.
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: { text: "old2", lineClass: "diff-line-del", lineNumber: 2 },
        right: { text: "new2", lineClass: "diff-line-add", lineNumber: 2 },
    });
    assert.equal(rows.length, 3);
});

test("test_computeSplitRows_leaves_short_side_empty_for_unequal_runs", () => {
    // Scenario: when the addition run outnumbers the deletion run, the surplus addition sits
    // beside an empty left cell.
    // Steps:
    // split a hunk holding one deletion then two additions.
    const rows = computeSplitRows("@@ -1,1 +1,2 @@\n-old1\n+new1\n+new2");
    // row 1 pairs the lone deletion with the first addition.
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "old1", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "new1", lineClass: "diff-line-add", lineNumber: 1 },
    });
    // row 2 carries only the surplus addition; the left cell is absent.
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "new2", lineClass: "diff-line-add", lineNumber: 2 },
    });
});

test("test_computeSplitRows_keeps_preamble_lines_full_width", () => {
    // Scenario: file-header lines before the first "@@" span both columns, keeping today's
    // inline color classes ("---" reads as del, "+++" as add — rendering parity).
    // Steps:
    // split a diff carrying a two-line preamble before its hunk.
    const rows = computeSplitRows("--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-x\n+y");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "--- a/f", lineClass: "diff-line-del" });
    assert.deepEqual(rows[1], { kind: SplitRowKind.full, text: "+++ b/f", lineClass: "diff-line-add" });
    assert.deepEqual(rows[2], { kind: SplitRowKind.full, text: "@@ -1,1 +1,1 @@", lineClass: "diff-line-hunk" });
    // the hunk's change lines still zip into one pair row.
    assert.deepEqual(rows[3], {
        kind: SplitRowKind.pair,
        left: { text: "x", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "y", lineClass: "diff-line-add", lineNumber: 1 },
    });
});

test("test_computeSplitRows_renders_non_diff_text_as_plain_full_rows", () => {
    // Scenario: the timeline surfaces feed fallback strings (no "@@" anywhere) through the same
    // renderer; they must come out as plain full-width rows.
    // Steps:
    // split a non-diff fallback message.
    const rows = computeSplitRows("(file unchanged across the picked range)");
    assert.deepEqual(rows, [{ kind: SplitRowKind.full, text: "(file unchanged across the picked range)", lineClass: "" }]);
});

test("test_computeSplitRows_advances_line_numbers_from_the_hunk_header_seed", () => {
    // Scenario: a hunk starting mid-file ("@@ -5,4 +7,5 @@") numbers its cells from each
    // side's seed: context advances both counters, a deletion only the old, an addition only
    // the new — and a revision-kind header ("@@ changed @ … @@") is a full-width row that
    // carries no numbers itself.
    // Steps:
    // split a revision block whose hunk starts at old line 5 / new line 7.
    const rows = computeSplitRows("@@ changed @ 2026-01-01T00:01:00.000Z @@\n@@ -5,4 +7,5 @@\n ctx1\n-del1\n+add1\n+add2\n ctx2");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ changed @ 2026-01-01T00:01:00.000Z @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[1], { kind: SplitRowKind.full, text: "@@ -5,4 +7,5 @@", lineClass: "diff-line-hunk" });
    // context: old 5, new 7.
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: { text: "ctx1", lineClass: "", lineNumber: 5 },
        right: { text: "ctx1", lineClass: "", lineNumber: 7 },
    });
    // deletion consumes old 6; the paired addition consumes new 8.
    assert.deepEqual(rows[3], {
        kind: SplitRowKind.pair,
        left: { text: "del1", lineClass: "diff-line-del", lineNumber: 6 },
        right: { text: "add1", lineClass: "diff-line-add", lineNumber: 8 },
    });
    // the surplus addition consumes new 9.
    assert.deepEqual(rows[4], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "add2", lineClass: "diff-line-add", lineNumber: 9 },
    });
    // the trailing context resumes both sides: old 7, new 10.
    assert.deepEqual(rows[5], {
        kind: SplitRowKind.pair,
        left: { text: "ctx2", lineClass: "", lineNumber: 7 },
        right: { text: "ctx2", lineClass: "", lineNumber: 10 },
    });
});

test("test_computeSplitRows_seeds_counters_from_gits_short_form_header_with_function_context", () => {
    // Scenario: real git omits ",count" when a side's count is 1 and appends function context
    // ("@@ -5 +5,2 @@ def reorder():") — the header must still render as a full-width hunk row
    // and seed both line counters from 5 (item 51).
    // Steps:
    // split a one-hunk diff headed by the git short form: one context line, one addition.
    const rows = computeSplitRows("@@ -5 +5,2 @@ def reorder():\n keep\n+born");
    // the git-shaped header is a full-width hunk row.
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ -5 +5,2 @@ def reorder():", lineClass: "diff-line-hunk" });
    // the context line is numbered from the header's seeds: old 5 / new 5.
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "keep", lineClass: "", lineNumber: 5 },
        right: { text: "keep", lineClass: "", lineNumber: 5 },
    });
    // the addition consumes new 6 beside an empty left cell.
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "born", lineClass: "diff-line-add", lineNumber: 6 },
    });
});

// -------------------- inline diff rows (item 40) --------------------

test("test_computeInlineRows_numbers_context_lines_on_both_sides", () => {
    // Scenario: inside a hunk, a context line carries a line number from BOTH files, each
    // seeded by the "@@ -a,b +c,d @@" header (old side from a, new side from c).
    // Steps:
    // compute inline rows for a one-hunk diff holding a single context line.
    const rows = computeInlineRows("@@ -3,2 +7,2 @@\n keep");
    // the context line keeps its raw unified " " prefix and is numbered old 3 / new 7.
    assert.deepEqual(rows[1], { text: " keep", lineClass: "", oldLineNumber: 3, newLineNumber: 7 });
});

test("test_computeInlineRows_numbers_deletions_on_old_side_only", () => {
    // Scenario: a deletion line exists only in the old file — it gets an old number and no new
    // number, and advances only the old counter.
    // Steps:
    // compute inline rows for a hunk holding one deletion then one context line.
    const rows = computeInlineRows("@@ -1,2 +1,1 @@\n-gone\n keep");
    // the deletion is numbered old 1 only.
    assert.deepEqual(rows[1], { text: "-gone", lineClass: "diff-line-del", oldLineNumber: 1 });
    // the following context line shows the deletion advanced only the old counter: old 2 / new 1.
    assert.deepEqual(rows[2], { text: " keep", lineClass: "", oldLineNumber: 2, newLineNumber: 1 });
});

test("test_computeInlineRows_numbers_additions_on_new_side_only", () => {
    // Scenario: an addition line exists only in the new file — it gets a new number and no old
    // number, and advances only the new counter.
    // Steps:
    // compute inline rows for a hunk holding one addition then one context line.
    const rows = computeInlineRows("@@ -1,1 +1,2 @@\n+born\n keep");
    // the addition is numbered new 1 only.
    assert.deepEqual(rows[1], { text: "+born", lineClass: "diff-line-add", newLineNumber: 1 });
    // the following context line shows the addition advanced only the new counter: old 1 / new 2.
    assert.deepEqual(rows[2], { text: " keep", lineClass: "", oldLineNumber: 1, newLineNumber: 2 });
});

test("test_computeInlineRows_leaves_preamble_and_hunk_headers_unnumbered", () => {
    // Scenario: lines before the first "@@" (revision-block preamble) and the hunk headers
    // themselves carry no line numbers; headers keep the hunk color class.
    // Steps:
    // compute inline rows for a diff carrying a preamble line before its hunk.
    const rows = computeInlineRows("revision #2\n@@ -1,1 +1,1 @@\n same");
    // the preamble row is plain and unnumbered.
    assert.deepEqual(rows[0], { text: "revision #2", lineClass: "" });
    // the hunk header row is hunk-colored and unnumbered.
    assert.deepEqual(rows[1], { text: "@@ -1,1 +1,1 @@", lineClass: "diff-line-hunk" });
    // the context line after the header is numbered from both seeds.
    assert.deepEqual(rows[2], { text: " same", lineClass: "", oldLineNumber: 1, newLineNumber: 1 });
});

test("test_computeInlineRows_seeds_counters_from_gits_short_form_header_with_function_context", () => {
    // Scenario: the inline view meets the same git short-form header ("@@ -5 +5,2 @@
    // def reorder():") — it renders as a hunk row and seeds both counters from 5 (item 51).
    // Steps:
    // compute inline rows for a one-hunk diff headed by the git short form.
    const rows = computeInlineRows("@@ -5 +5,2 @@ def reorder():\n keep\n+born");
    // the git-shaped header row is hunk-colored and unnumbered.
    assert.deepEqual(rows[0], { text: "@@ -5 +5,2 @@ def reorder():", lineClass: "diff-line-hunk" });
    // the context line is numbered from the header's seeds: old 5 / new 5.
    assert.deepEqual(rows[1], { text: " keep", lineClass: "", oldLineNumber: 5, newLineNumber: 5 });
    // the addition consumes new 6 only.
    assert.deepEqual(rows[2], { text: "+born", lineClass: "diff-line-add", newLineNumber: 6 });
});

test("test_resolveInitialDiffDisplayMode_returns_stored_mode", () => {
    // Scenario: a previous visit stored "inline" in localStorage — the diff toggle comes back
    // in inline mode after a reload (item 10f).
    // Steps:
    // resolve the stored wire string "inline".
    // assert the result is the DiffDisplayMode.inline enum member.
    assert.equal(resolveInitialDiffDisplayMode("inline"), DiffDisplayMode.inline);
});

test("test_resolveInitialDiffDisplayMode_defaults_to_split", () => {
    // Scenario: nothing stored (localStorage.getItem returns null) or an unrecognized stored
    // value falls back to the split default.
    // Steps:
    // assert null (no stored value) resolves to DiffDisplayMode.split.
    assert.equal(resolveInitialDiffDisplayMode(null), DiffDisplayMode.split);
    // assert an unrecognized value resolves to DiffDisplayMode.split.
    assert.equal(resolveInitialDiffDisplayMode("weird"), DiffDisplayMode.split);
});
