// Task 888: which instants the visible ruler rows cover.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVisibleInstantRange, EARLIEST_INSTANT, LATEST_INSTANT } from "../webapp/layer1-components/session-column/layer1-session-dots-viewport.ts";
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

// One row per axisPx value; the row at index N has the instant of hour N.
function buildRowsAtAxisPx(axisPxList: number[]): RulerRow[] {
    const rows: RulerRow[] = [];
    for (const [hour, axisPx] of axisPxList.entries()) {
        rows.push(buildRow(axisPx, [buildInstantAtHour(hour)]));
    }
    return rows;
}

test("test_in_session_layout_a_window_holding_the_first_row_asks_from_the_earliest_instant", () => {
    // A window with no edge row asks the same range as time layout.
    const middleRange = computeVisibleInstantRange(buildFiveRows(), 150, 250, true);
    assert.deepEqual(middleRange, { from: buildInstantAtHour(1), to: buildInstantAtHour(3) });
    // A window above every row reaches back to the earliest instant.
    const aboveRange = computeVisibleInstantRange(buildFiveRows(), -500, -100, true);
    assert.deepEqual(aboveRange, { from: EARLIEST_INSTANT, to: buildInstantAtHour(0) });
    // A window that shows the first row reaches back to the earliest instant.
    const topRange = computeVisibleInstantRange(buildFiveRows(), 0, 150, true);
    assert.deepEqual(topRange, { from: EARLIEST_INSTANT, to: buildInstantAtHour(2) });
});

test("test_in_session_layout_a_window_holding_the_last_row_asks_to_the_latest_instant", () => {
    // A window that shows the last row reaches forward to the latest instant.
    const bottomRange = computeVisibleInstantRange(buildFiveRows(), 350, 450, true);
    assert.deepEqual(bottomRange, { from: buildInstantAtHour(3), to: LATEST_INSTANT });
    // A window below every row reaches forward to the latest instant.
    const belowRange = computeVisibleInstantRange(buildFiveRows(), 500, 600, true);
    assert.deepEqual(belowRange, { from: buildInstantAtHour(4), to: LATEST_INSTANT });
});

test("test_in_session_layout_one_row_asks_from_the_earliest_to_the_latest_instant", () => {
    // The only row is both the first row and the last row.
    const range = computeVisibleInstantRange([buildRow(0, [buildInstantAtHour(2)])], 0, 100, true);
    assert.deepEqual(range, { from: EARLIEST_INSTANT, to: LATEST_INSTANT });
});

test("test_a_window_wholly_inside_one_tall_row_still_asks_for_that_row", () => {
    // Four tall rows; the window 6000..6900 lies inside the block of the row at 5000.
    const rows = buildRowsAtAxisPx([0, 5000, 10000, 15000]);
    const expectedRange = { from: buildInstantAtHour(1), to: buildInstantAtHour(2) };
    // Session layout asks for the block of that row.
    assert.deepEqual(computeVisibleInstantRange(rows, 6000, 6900, true), expectedRange);
    // Time layout asks for the same block.
    assert.deepEqual(computeVisibleInstantRange(rows, 6000, 6900), expectedRange);
});

test("test_a_window_inside_the_last_tall_row_asks_to_the_latest_instant", () => {
    // Two tall rows; the window 6000..6900 lies inside the block of the last row.
    const rows = buildRowsAtAxisPx([0, 5000]);
    const range = computeVisibleInstantRange(rows, 6000, 6900, true);
    // The last block runs on to the latest instant.
    assert.deepEqual(range, { from: buildInstantAtHour(1), to: LATEST_INSTANT });
});

test("test_the_edge_instants_are_dates_the_server_accepts", () => {
    // Both edge instants read as real dates.
    assert.equal(Number.isNaN(new Date(EARLIEST_INSTANT).getTime()), false);
    assert.equal(Number.isNaN(new Date(LATEST_INSTANT).getTime()), false);
    // Both survive a trip through a query string unchanged.
    const query = new URLSearchParams({ from: EARLIEST_INSTANT, to: LATEST_INSTANT });
    const readBack = new URLSearchParams(query.toString());
    assert.equal(readBack.get("from"), EARLIEST_INSTANT);
    assert.equal(readBack.get("to"), LATEST_INSTANT);
});
