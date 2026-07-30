// Task 329: the instant-range → per-file step-pair rule behind the base/target wash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRangeStepIndexes } from "../webapp/layer1-diff-wash.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";

test("a range holding many nodes picks the first and last inside", () => {
    // Five chronological steps, wash T1..T3: pair = first and last steps inside the range.
    assert.deepEqual(resolveRangeStepIndexes([T0, T1, T2, T3, T4], T1, T3), { baseIndex: 1, targetIndex: 3 });
});

test("a range holding one node uses it for both sides", () => {
    // Only T2 falls inside T1..T3, so base and target are the same step — an empty diff.
    assert.deepEqual(resolveRangeStepIndexes([T0, T2, T4], T1, T3), { baseIndex: 1, targetIndex: 1 });
});

test("a range holding no nodes holds the preceding state", () => {
    // Nothing changed during T2..T3; the state throughout is the last step at-or-before T2.
    assert.deepEqual(resolveRangeStepIndexes([T0, T1, T4], T2, T3), { baseIndex: 1, targetIndex: 1 });
});

test("a file born after the range resolves to undefined", () => {
    // Every step post-dates the wash: the file had no state inside the selected range.
    assert.equal(resolveRangeStepIndexes([T3, T4], T0, T2), undefined);
});

test("boundary instants are inclusive on both edges", () => {
    // Steps sitting exactly ON the wash edges belong to the range.
    assert.deepEqual(resolveRangeStepIndexes([T1, T2, T3], T1, T3), { baseIndex: 0, targetIndex: 2 });
});
