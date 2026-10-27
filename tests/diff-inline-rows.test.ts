import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInlineRows } from "../webapp/diff-inline-rows.ts";

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
