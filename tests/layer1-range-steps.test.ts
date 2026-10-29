// Task 329: the instant-range to per-file step-pair rule behind the base/target wash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInstantInRange, resolveRangeStepIndexes } from "../webapp/layer1-range-steps.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";

test("a range holding many nodes picks the first and last inside", () => {
    assert.deepEqual(resolveRangeStepIndexes([T0, T1, T2, T3, T4], T1, T3), { baseIndex: 1, targetIndex: 3 });
});

test("a range holding one node uses it for both sides", () => {
    assert.deepEqual(resolveRangeStepIndexes([T0, T2, T4], T1, T3), { baseIndex: 1, targetIndex: 1 });
});

test("a range holding no nodes holds the preceding state", () => {
    assert.deepEqual(resolveRangeStepIndexes([T0, T1, T4], T2, T3), { baseIndex: 1, targetIndex: 1 });
});

test("a file born after the range resolves to undefined", () => {
    assert.equal(resolveRangeStepIndexes([T3, T4], T0, T2), undefined);
});

test("boundary instants are inclusive on both edges", () => {
    assert.deepEqual(resolveRangeStepIndexes([T1, T2, T3], T1, T3), { baseIndex: 0, targetIndex: 2 });
});

test("hasInstantInRange is true when at least one instant lands inside the range", () => {
    assert.equal(hasInstantInRange([T0, T2, T4], T1, T3), true);
});

test("hasInstantInRange is false when every instant falls outside the range", () => {
    assert.equal(hasInstantInRange([T3, T4], T0, T1), false);
});

test("hasInstantInRange treats boundary instants as inside", () => {
    assert.equal(hasInstantInRange([T1], T1, T3), true);
});

test("hasInstantInRange is false for an empty step list", () => {
    assert.equal(hasInstantInRange([], T0, T4), false);
});
