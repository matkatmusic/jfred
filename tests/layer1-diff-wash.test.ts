// Task 329: the base/target wash paints one range and survives a stage re-render.

import { test } from "node:test";
import assert from "node:assert/strict";
import { axisPixelsForInstant, clearDiffWash, paintDiffWash, repaintDiffWash } from "../webapp/layer1-diff-wash.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const T1 = "2026-07-01T11:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";

const RULER: WireRulerTick[] = [
    { instant: T1, axisPx: 20, eventCount: 1 },
    { instant: T3, axisPx: 120, eventCount: 1 },
];

// Task 333: renderSessionRanges replaces #washes wholesale on every stage re-render.
function simulateStageRerenderWipingWashes(): void {
    document.getElementById("washes")!.replaceChildren();
}

test("paintDiffWash draws one .diff-wash spanning base to target", () => {
    initLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 1);
});

test("repaintDiffWash restores the diff wash after an unrelated stage re-render wipes #washes", () => {
    initLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    simulateStageRerenderWipingWashes();
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 0);
    repaintDiffWash(RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 1);
});

test("clearDiffWash forgets the range, so a later repaint stays a no-op", () => {
    initLayer1Dom();
    paintDiffWash(T1, T3, RULER);
    clearDiffWash();
    simulateStageRerenderWipingWashes();
    repaintDiffWash(RULER);
    assert.equal(document.querySelectorAll("#washes .diff-wash").length, 0);
});

test("axisPixelsForInstant returns the ruler tick's own pixels for an exact instant", () => {
    assert.equal(axisPixelsForInstant(T3, RULER), 120);
});
