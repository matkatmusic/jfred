// Task 888: which instants the visible ruler rows cover.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVisibleInstantRange } from "../webapp/layer1-components/session-column/layer1-session-dots-viewport.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";

const HOUR_MS = 60 * 60 * 1000;
const FIRST_INSTANT_MS = Date.parse("2026-06-01T00:00:00.000Z");

function buildInstantAtHour(hour: number): string {
    return new Date(FIRST_INSTANT_MS + hour * HOUR_MS).toISOString();
}

function buildRow(axisPx: number, instants: string[]): RulerRow {
    return { axisPx, text: "", eventCount: 1, axisPxList: [axisPx], instants };
}

// Rows at axisPx 0, 100, 200, 300, 400 with instants one hour apart.
function buildFiveRows(): RulerRow[] {
    const rows: RulerRow[] = [];
    for (const hour of [0, 1, 2, 3, 4]) {
        rows.push(buildRow(hour * 100, [buildInstantAtHour(hour)]));
    }
    return rows;
}

test("test_the_range_covers_the_rows_in_the_window_and_one_row_past_each_edge", () => {
    // Window 150..250 holds only the row at 200.
    // One row past each edge adds the rows at 100 and 300.
    const range = computeVisibleInstantRange(buildFiveRows(), 150, 250);
    assert.deepEqual(range, { from: buildInstantAtHour(1), to: buildInstantAtHour(3) });
});

test("test_a_window_between_two_rows_takes_both_neighbors", () => {
    // Window 110..190 holds no row; the rows at 100 and 200 are its neighbors.
    const range = computeVisibleInstantRange(buildFiveRows(), 110, 190);
    assert.deepEqual(range, { from: buildInstantAtHour(1), to: buildInstantAtHour(2) });
});

test("test_a_window_above_the_first_row_starts_at_the_first_row", () => {
    // Window -500..-100 lies above every row.
    const range = computeVisibleInstantRange(buildFiveRows(), -500, -100);
    assert.deepEqual(range, { from: buildInstantAtHour(0), to: buildInstantAtHour(0) });
});

test("test_a_window_below_the_last_row_ends_at_the_last_row", () => {
    // Window 500..600 lies below every row.
    const range = computeVisibleInstantRange(buildFiveRows(), 500, 600);
    assert.deepEqual(range, { from: buildInstantAtHour(4), to: buildInstantAtHour(4) });
});

test("test_no_rows_give_no_range", () => {
    // An empty row list has no instants.
    const range = computeVisibleInstantRange([], 0, 100);
    assert.equal(range, undefined);
});

test("test_an_expanded_row_uses_the_earliest_and_latest_absorbed_instant", () => {
    // One row stands for three instants, listed out of order.
    const absorbedInstants = [buildInstantAtHour(5), buildInstantAtHour(2), buildInstantAtHour(9)];
    const range = computeVisibleInstantRange([buildRow(0, absorbedInstants)], 0, 100);
    // The range uses the earliest and the latest of the three.
    assert.deepEqual(range, { from: buildInstantAtHour(2), to: buildInstantAtHour(9) });
});
