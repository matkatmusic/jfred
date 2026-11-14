// Hand-built ticks: the anchor functions read only `instant` and `axisPx`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeAnchoredTopAxisPx,
    findTopRowAnchor,
} from "../webapp/layer1-components/session-column/layer1-session-scroll-anchor.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

const INSTANT_A = "2026-07-25T12:00:00.000Z";
const INSTANT_B = "2026-07-25T13:00:00.000Z";
const INSTANT_C = "2026-07-25T14:00:00.000Z";

function buildTick(instant: string, axisPx: number): WireRulerTick {
    return { instant, axisPx, eventCount: 1 };
}

function buildThreeTicks(axisPxA: number, axisPxB: number, axisPxC: number): WireRulerTick[] {
    const ticks: WireRulerTick[] = [];
    ticks.push(buildTick(INSTANT_A, axisPxA));
    ticks.push(buildTick(INSTANT_B, axisPxB));
    ticks.push(buildTick(INSTANT_C, axisPxC));
    return ticks;
}

test("test_the_anchor_is_the_first_row_at_or_below_the_top", () => {
    // Setup: rows at 0, 50 and 100.
    const ticks = buildThreeTicks(0, 50, 100);
    // Action: the pane top is at 40.
    const anchor = findTopRowAnchor(ticks, 40);
    // Check: the anchor is the row at 50, which sits 10 below the top.
    assert.equal(anchor.instant, INSTANT_B);
    assert.equal(anchor.offsetPx, 10);
});

test("test_the_anchor_on_a_row_exactly_at_the_top_has_offset_zero", () => {
    // Setup: rows at 0, 50 and 100.
    const ticks = buildThreeTicks(0, 50, 100);
    // Action: the pane top is exactly at the middle row.
    const anchor = findTopRowAnchor(ticks, 50);
    // Check: the middle row is the anchor with no offset.
    assert.equal(anchor.instant, INSTANT_B);
    assert.equal(anchor.offsetPx, 0);
});

test("test_the_anchor_past_the_last_row_is_the_last_row", () => {
    // Setup: rows at 0, 50 and 100.
    const ticks = buildThreeTicks(0, 50, 100);
    // Action: the pane top is at 150, below every row.
    const anchor = findTopRowAnchor(ticks, 150);
    // Check: the last row is the anchor, 50 above the top.
    assert.equal(anchor.instant, INSTANT_C);
    assert.equal(anchor.offsetPx, -50);
});

test("test_the_anchored_scroll_top_keeps_the_row_at_the_same_offset", () => {
    // Setup: an anchor on row B, 10 below the top.
    const anchor = { instant: INSTANT_B, offsetPx: 10 };
    // Action: the new layout puts row B at 900.
    const newTicks = buildThreeTicks(0, 900, 1000);
    const newTopAxisPx = computeAnchoredTopAxisPx(anchor, newTicks);
    // Check: the top is 10 above row B.
    assert.equal(newTopAxisPx, 890);
});

test("test_an_anchor_row_missing_from_the_new_ticks_throws", () => {
    // Setup: an anchor on a row that the new layout does not have.
    const anchor = { instant: "2026-07-26T00:00:00.000Z", offsetPx: 10 };
    const newTicks = buildThreeTicks(0, 50, 100);
    // Check: asking for the new top throws.
    assert.throws(() => computeAnchoredTopAxisPx(anchor, newTicks), /missing from the ruler/);
});
