// The two report writers that decide how much of a failing run reaches the reader.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Violation } from "../scripts/visual/violation-geometry.ts";
import { formatViolationSummary, listExamples } from "../scripts/visual/violation-report.ts";

function violation(state: string, rule: string, detail: string): Violation {
    return { state, rule, detail };
}

test("formatViolationSummary counts violations per state and rule", () => {
    const lines = formatViolationSummary([
        violation("01-initial-load", "overlapping-nodes", "a"),
        violation("01-initial-load", "overlapping-nodes", "b"),
        violation("06-zoomed-out", "overlapping-nodes", "c"),
    ]);
    assert.deepEqual(lines, [
        "  FAIL 01-initial-load · overlapping-nodes × 2",
        "  FAIL 06-zoomed-out · overlapping-nodes × 1",
    ]);
});

test("listExamples caps each rule so 800 rectangles cannot flood the report", () => {
    const many = Array.from({ length: 50 }, (_, index) => violation("s", "overlapping-nodes", `hit ${index}`));
    const lines = listExamples([...many, violation("s", "wrapped-commit-row", "tall")], 2);
    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /wrapped-commit-row: tall/);
});
