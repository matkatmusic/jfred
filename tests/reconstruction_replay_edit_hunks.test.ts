import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectRemovedOldIndices,
    collectSurvivingLines,
    getHunkPreEditLines,
} from "../src/reconstruction_replay_edit_hunks.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-result-shapes.ts";

const replaceSecondLine: StructuredPatchHunk = {
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
    lines: [" a", "-b", "+B", " c"],
};

test("test_collect_removed_old_indices_marks_only_minus_lines", () => {
    assert.deepEqual([...collectRemovedOldIndices(replaceSecondLine)], [1]);
});

test("test_collect_surviving_lines_keeps_previous_index_as_old_line_number", () => {
    const previous = [{ oldLineNum: 0, values: [] }, { oldLineNum: 1, values: [] }, { oldLineNum: 2, values: [] }];
    const survivors = collectSurvivingLines(previous, new Set([1]));
    assert.deepEqual(survivors.map((line) => line.oldLineNum), [0, 2]);
});

test("test_get_hunk_pre_edit_lines_restores_removed_line", () => {
    assert.deepEqual(getHunkPreEditLines(["a", "B", "c"], replaceSecondLine), ["a", "b", "c"]);
});

test("test_get_hunk_pre_edit_lines_returns_undefined_on_mismatch", () => {
    assert.equal(getHunkPreEditLines(["a", "X", "c"], replaceSecondLine), undefined);
});
