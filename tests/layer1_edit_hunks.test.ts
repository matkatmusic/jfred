// Task 355 step 1: string-level hunk helpers shared by the engine and the fixture.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHunksToLines, isHunkMatchingBase } from "../src/layer1_edit_hunks.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-result-shapes.ts";

const BASE = ["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"];
const REPLACE_L5: StructuredPatchHunk = {
    oldStart: 3, oldLines: 7, newStart: 3, newLines: 7,
    lines: [" l2", " l3", " l4", "-l5", "+new5", " l6", " l7", " l8"],
};
const INSERT_AFTER_L1: StructuredPatchHunk = {
    oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
    lines: [" l0", " l1", "+added"],
};

test("test_hunk_matches_base_when_context_and_removed_rows_equal", () => {
    assert.equal(isHunkMatchingBase(BASE, REPLACE_L5), true);
});

test("test_hunk_rejects_changed_context_line", () => {
    const changed = BASE.map((line) => (line === "l6" ? "other" : line));
    assert.equal(isHunkMatchingBase(changed, REPLACE_L5), false);
});

test("test_apply_hunks_inserts_and_removes_rows", () => {
    assert.deepEqual(
        applyHunksToLines(BASE, [INSERT_AFTER_L1, REPLACE_L5]),
        ["l0", "l1", "added", "l2", "l3", "l4", "new5", "l6", "l7", "l8", "l9"],
    );
});

test("test_apply_hunks_best_effort_keeps_base_text_on_mismatch", () => {
    const changed = BASE.map((line) => (line === "l6" ? "drifted" : line));
    const applied = applyHunksToLines(changed, [REPLACE_L5]);
    assert.deepEqual(applied, ["l0", "l1", "l2", "l3", "l4", "new5", "drifted", "l7", "l8", "l9"]);
});
