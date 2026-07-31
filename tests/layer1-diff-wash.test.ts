// Task 329: the instant-range → per-file step-pair rule behind the base/target wash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clearDiffWash, hasInstantInRange, paintDiffWash, repaintDiffWash, resolveRangeStepIndexes } from "../webapp/layer1-diff-wash.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";

const RULER: WireRulerTick[] = [
    { instant: T1, axisPx: 20, eventCount: 1 },
    { instant: T3, axisPx: 120, eventCount: 1 },
];

// Task 333: renderSessionRanges replaces #washes wholesale on every stage re-render.
function simulateStageRerenderWipingWashes(): void {
    document.getElementById("washes")!.replaceChildren();
}

test("paintDiffWash draws one .diff-wash spanning base to target", () => {
    setupLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 1);
});

test("repaintDiffWash restores the diff wash after an unrelated stage re-render wipes #washes", () => {
    setupLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    simulateStageRerenderWipingWashes();
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 0);
    repaintDiffWash(RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 1);
});

test("clearDiffWash forgets the range, so a later repaint stays a no-op", () => {
    setupLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    clearDiffWash();
    simulateStageRerenderWipingWashes();
    repaintDiffWash(RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 0);
});

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

test("hasInstantInRange is true when at least one instant lands inside the range", () => {
    // Steps: T0 and T4 sit outside T1..T3; T2 sits inside — one hit is enough.
    assert.equal(hasInstantInRange([T0, T2, T4], T1, T3), true);
});

test("hasInstantInRange is false when every instant falls outside the range", () => {
    // Steps: both T3 and T4 post-date the T0..T1 range — no hit at all.
    assert.equal(hasInstantInRange([T3, T4], T0, T1), false);
});

test("hasInstantInRange treats boundary instants as inside", () => {
    // Steps: T1 sits exactly ON the range's own start edge — inclusive, so it counts.
    assert.equal(hasInstantInRange([T1], T1, T3), true);
});

test("hasInstantInRange is false for an empty step list", () => {
    // Steps: no instants at all — a path with no ladder never touches a range.
    assert.equal(hasInstantInRange([], T0, T4), false);
});
