// Tests for src/viewer_api_diffs.ts: query parsing, patch root, and range checks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import {
    computePatchRoot,
    computeStepFiles,
    parseRangePatchQuery,
    parseStepFilesQuery,
    renderRangePatch,
} from "../src/viewer_api_diffs.ts";
import type { FileHistory } from "../src/reconstruction_events.ts";

function createHistoryAt(filePath: string): FileHistory {
    return { target: { toString: () => filePath } } as unknown as FileHistory;
}

test("test_parseRangePatchQuery_reads_both_steps_and_rejects_bad_values", () => {
    // Scenario: both params parse as integers; missing, fractional, and zero values throw.
    assert.deepEqual(parseRangePatchQuery(new URLSearchParams("fromStep=2&toStep=5")), { fromStep: 2, toStep: 5 });
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=2")), /missing query param: toStep/);
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=1.5&toStep=2")), /must be an integer/);
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=0&toStep=2")), /must be >= 1/);
});

test("test_parseStepFilesQuery_reads_step", () => {
    // Scenario: the step param parses as a positive integer.
    assert.deepEqual(parseStepFilesQuery(new URLSearchParams("step=3")), { step: 3 });
});

test("test_computePatchRoot_returns_longest_shared_directory", () => {
    // Scenario: the root is the longest directory prefix shared by every tracked file.
    const histories = [createHistoryAt(`${sep}a${sep}b${sep}x.ts`), createHistoryAt(`${sep}a${sep}b${sep}c${sep}y.ts`)];
    assert.equal(computePatchRoot(histories), `${sep}a${sep}b`);
    assert.equal(computePatchRoot([]), sep);
});

test("test_computeStepFiles_and_renderRangePatch_throw_when_out_of_range", () => {
    // Scenario: step numbers outside 1..steps.length and reversed ranges throw loudly.
    assert.throws(() => computeStepFiles([], [], 0), /step 0 out of range/);
    assert.throws(() => computeStepFiles([], [], 1), /step 1 out of range/);
    assert.throws(() => renderRangePatch([], [], 0, 1), /fromStep 0 out of range/);
    assert.throws(() => renderRangePatch([], [], 1, 1), /toStep 1 out of range/);
});
