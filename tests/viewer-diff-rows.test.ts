import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInlineRows, computeSplitRows, DiffDisplayMode, resolveInitialDiffDisplayMode, SplitRowKind } from "../webapp/views/diff-vs-base-model.ts";

test("test_computeSplitRows_renders_context_line_in_both_columns", () => {
    // A context line must read identically on both sides, numbered from each side's header seed.
    const rows = computeSplitRows("@@ -1,3 +1,3 @@\n unchanged");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ -1,3 +1,3 @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "unchanged", lineClass: "", lineNumber: 1 },
        right: { text: "unchanged", lineClass: "", lineNumber: 1 },
    });
});

test("test_computeSplitRows_zips_equal_deletion_and_addition_runs", () => {
    // Equal-length deletion and addition runs must zip row-by-row rather than stack.
    const rows = computeSplitRows("@@ -1,2 +1,2 @@\n-old1\n-old2\n+new1\n+new2");
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "old1", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "new1", lineClass: "diff-line-add", lineNumber: 1 },
    });
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: { text: "old2", lineClass: "diff-line-del", lineNumber: 2 },
        right: { text: "new2", lineClass: "diff-line-add", lineNumber: 2 },
    });
    assert.equal(rows.length, 3);
});

test("test_computeSplitRows_leaves_short_side_empty_for_unequal_runs", () => {
    // A surplus addition has no deletion to pair with, so its left cell must stay empty.
    const rows = computeSplitRows("@@ -1,1 +1,2 @@\n-old1\n+new1\n+new2");
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "old1", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "new1", lineClass: "diff-line-add", lineNumber: 1 },
    });
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "new2", lineClass: "diff-line-add", lineNumber: 2 },
    });
});

test("test_computeSplitRows_keeps_preamble_lines_full_width", () => {
    // Preamble lines keep the inline view's color classes so both renderers look the same.
    const rows = computeSplitRows("--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-x\n+y");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "--- a/f", lineClass: "diff-line-del" });
    assert.deepEqual(rows[1], { kind: SplitRowKind.full, text: "+++ b/f", lineClass: "diff-line-add" });
    assert.deepEqual(rows[2], { kind: SplitRowKind.full, text: "@@ -1,1 +1,1 @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[3], {
        kind: SplitRowKind.pair,
        left: { text: "x", lineClass: "diff-line-del", lineNumber: 1 },
        right: { text: "y", lineClass: "diff-line-add", lineNumber: 1 },
    });
});

test("test_computeSplitRows_renders_non_diff_text_as_plain_full_rows", () => {
    // The timeline feeds fallback strings through this same renderer, so non-diff text must survive.
    const rows = computeSplitRows("(file unchanged across the picked range)");
    assert.deepEqual(rows, [{ kind: SplitRowKind.full, text: "(file unchanged across the picked range)", lineClass: "" }]);
});

test("test_computeSplitRows_advances_line_numbers_from_the_hunk_header_seed", () => {
    // A mid-file hunk proves each side's counter advances only for the lines that side owns.
    const rows = computeSplitRows("@@ changed @ 2026-01-01T00:01:00.000Z @@\n@@ -5,4 +7,5 @@\n ctx1\n-del1\n+add1\n+add2\n ctx2");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ changed @ 2026-01-01T00:01:00.000Z @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[1], { kind: SplitRowKind.full, text: "@@ -5,4 +7,5 @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: { text: "ctx1", lineClass: "", lineNumber: 5 },
        right: { text: "ctx1", lineClass: "", lineNumber: 7 },
    });
    assert.deepEqual(rows[3], {
        kind: SplitRowKind.pair,
        left: { text: "del1", lineClass: "diff-line-del", lineNumber: 6 },
        right: { text: "add1", lineClass: "diff-line-add", lineNumber: 8 },
    });
    assert.deepEqual(rows[4], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "add2", lineClass: "diff-line-add", lineNumber: 9 },
    });
    assert.deepEqual(rows[5], {
        kind: SplitRowKind.pair,
        left: { text: "ctx2", lineClass: "", lineNumber: 7 },
        right: { text: "ctx2", lineClass: "", lineNumber: 10 },
    });
});

test("test_computeSplitRows_seeds_counters_from_gits_short_form_header_with_function_context", () => {
    // Real git omits ",count" when a side's count is 1 and appends function context (item 51).
    const rows = computeSplitRows("@@ -5 +5,2 @@ def reorder():\n keep\n+born");
    assert.deepEqual(rows[0], { kind: SplitRowKind.full, text: "@@ -5 +5,2 @@ def reorder():", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[1], {
        kind: SplitRowKind.pair,
        left: { text: "keep", lineClass: "", lineNumber: 5 },
        right: { text: "keep", lineClass: "", lineNumber: 5 },
    });
    assert.deepEqual(rows[2], {
        kind: SplitRowKind.pair,
        left: undefined,
        right: { text: "born", lineClass: "diff-line-add", lineNumber: 6 },
    });
});

test("test_computeInlineRows_numbers_context_lines_on_both_sides", () => {
    // A context line exists in both files, so it must carry a number seeded from each side.
    const rows = computeInlineRows("@@ -3,2 +7,2 @@\n keep");
    assert.deepEqual(rows[1], { text: " keep", lineClass: "", oldLineNumber: 3, newLineNumber: 7 });
});

test("test_computeInlineRows_numbers_deletions_on_old_side_only", () => {
    // A deletion exists only in the old file, so it may advance only the old counter.
    const rows = computeInlineRows("@@ -1,2 +1,1 @@\n-gone\n keep");
    assert.deepEqual(rows[1], { text: "-gone", lineClass: "diff-line-del", oldLineNumber: 1 });
    assert.deepEqual(rows[2], { text: " keep", lineClass: "", oldLineNumber: 2, newLineNumber: 1 });
});

test("test_computeInlineRows_numbers_additions_on_new_side_only", () => {
    // An addition exists only in the new file, so it may advance only the new counter.
    const rows = computeInlineRows("@@ -1,1 +1,2 @@\n+born\n keep");
    assert.deepEqual(rows[1], { text: "+born", lineClass: "diff-line-add", newLineNumber: 1 });
    assert.deepEqual(rows[2], { text: " keep", lineClass: "", oldLineNumber: 1, newLineNumber: 2 });
});

test("test_computeInlineRows_leaves_preamble_and_hunk_headers_unnumbered", () => {
    // Preamble and hunk-header rows belong to neither file, so numbering them would be meaningless.
    const rows = computeInlineRows("revision #2\n@@ -1,1 +1,1 @@\n same");
    assert.deepEqual(rows[0], { text: "revision #2", lineClass: "" });
    assert.deepEqual(rows[1], { text: "@@ -1,1 +1,1 @@", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[2], { text: " same", lineClass: "", oldLineNumber: 1, newLineNumber: 1 });
});

test("test_computeInlineRows_seeds_counters_from_gits_short_form_header_with_function_context", () => {
    // The inline view must seed counters from git's short-form header too (item 51).
    const rows = computeInlineRows("@@ -5 +5,2 @@ def reorder():\n keep\n+born");
    assert.deepEqual(rows[0], { text: "@@ -5 +5,2 @@ def reorder():", lineClass: "diff-line-hunk" });
    assert.deepEqual(rows[1], { text: " keep", lineClass: "", oldLineNumber: 5, newLineNumber: 5 });
    assert.deepEqual(rows[2], { text: "+born", lineClass: "diff-line-add", newLineNumber: 6 });
});

test("test_resolveInitialDiffDisplayMode_returns_stored_mode", () => {
    // A stored preference must survive a reload (item 10f).
    assert.equal(resolveInitialDiffDisplayMode("inline"), DiffDisplayMode.inline);
});

test("test_resolveInitialDiffDisplayMode_defaults_to_split", () => {
    // Nothing stored, or a value from an older build, must not leave the toggle in no mode.
    assert.equal(resolveInitialDiffDisplayMode(null), DiffDisplayMode.split);
    assert.equal(resolveInitialDiffDisplayMode("weird"), DiffDisplayMode.split);
});
