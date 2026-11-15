import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BARS_RULER_LOADING_CLASS,
    BARS_SELECTED_TICK_CLASS,
    computeBarPercent,
    findRealRulerTickRowIndex,
    findRulerRowIndexForInstant,
    findRulerRowIndexForSelectedTime,
    listRealRulerRows,
    markRealRulerRowSelected,
    setRealRulerLoading,
} from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import { initBarsDom } from "./layer1-bars-test-helpers.ts";

const INSTANT_08 = "2026-11-13T08:00:00.000Z";
const INSTANT_09 = "2026-11-13T09:00:00.000Z";
const INSTANT_10 = "2026-11-13T10:00:00.000Z";
const INSTANT_11 = "2026-11-13T11:00:00.000Z";
const INSTANT_12 = "2026-11-13T12:00:00.000Z";
const INSTANT_13 = "2026-11-13T13:00:00.000Z";

function buildRow(text: string, instants: string[]): RulerRow {
    return { axisPx: 0, text, eventCount: instants.length, axisPxList: instants.map(() => 0), instants };
}

// Newest first: row 0 holds 12:00, row 1 holds 10:00 and 10:30, row 2 holds 08:00.
function buildThreeRows(): RulerRow[] {
    return [buildRow("r0", [INSTANT_12]), buildRow("r1", [INSTANT_10, "2026-11-13T10:30:00.000Z"]), buildRow("r2", [INSTANT_08])];
}

// Makes the real ruler with one tick per row. Ticks are in the page oldest first, so the rows are given newest first and stored in reverse.
function buildRulerWithRows(rowsNewestFirst: RulerRow[]): HTMLElement[] {
    initBarsDom();
    const ruler = document.createElement("div");
    ruler.id = "timelineRulerComponent";
    document.body.appendChild(ruler);
    const ticksOldestFirst: HTMLElement[] = [];
    for (const row of [...rowsNewestFirst].reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, row);
        ticksOldestFirst.push(tick);
    }
    return ticksOldestFirst;
}

test("test_the_rows_of_the_real_ruler_are_listed_newest_first", () => {
    // Scenario: three ticks in the page, oldest first.
    const rowsNewestFirst = buildThreeRows();
    buildRulerWithRows(rowsNewestFirst);
    // The list holds the stored rows, newest first.
    assert.deepEqual(listRealRulerRows(), rowsNewestFirst);
});

test("test_a_tick_with_no_stored_row_throws", () => {
    // Scenario: a tick exists in the real ruler but no row was stored for it.
    buildRulerWithRows(buildThreeRows());
    const strayTick = document.createElement("div");
    strayTick.className = "tick";
    document.getElementById("timelineRulerComponent")!.appendChild(strayTick);
    // Listing the rows throws.
    assert.throws(() => listRealRulerRows(), /ruler tick has no stored row/);
});

test("test_the_row_index_of_a_tick_counts_from_the_newest_tick", () => {
    // Scenario: three ticks in the page, oldest first.
    const ticksOldestFirst = buildRulerWithRows(buildThreeRows());
    // The newest tick is index 0 and the oldest tick is index 2.
    assert.equal(findRealRulerTickRowIndex(ticksOldestFirst[2]!), 0);
    assert.equal(findRealRulerTickRowIndex(ticksOldestFirst[0]!), 2);
});

test("test_find_row_index_of_null_is_zero", () => {
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), null), 0);
});

test("test_find_row_index_of_an_instant_that_a_row_holds_returns_that_row", () => {
    // Scenario: 10:30 is the newest instant of row 1.
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), "2026-11-13T10:30:00.000Z"), 1);
});

test("test_find_row_index_of_an_instant_equal_to_the_oldest_instant_of_a_row_returns_that_row", () => {
    // Scenario: 10:00 is the oldest instant of row 1.
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), INSTANT_10), 1);
});

test("test_find_row_index_of_an_instant_inside_a_merged_row_returns_that_row", () => {
    // Scenario: row 1 holds 10:00 and 11:00 (two different labels); 10:30 equals neither.
    const rows = [buildRow("r0", [INSTANT_13]), buildRow("r1", [INSTANT_10, INSTANT_11]), buildRow("r2", [INSTANT_08])];
    assert.equal(findRulerRowIndexForInstant(rows, "2026-11-13T10:30:00.000Z"), 1);
});

test("test_find_row_index_of_an_instant_between_two_rows_returns_the_newer_row", () => {
    // Scenario: 11:00 lies between row 1 (newest 10:30) and row 0 (12:00).
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), INSTANT_11), 0);
    // 09:00 lies between row 2 (08:00) and row 1.
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), INSTANT_09), 1);
});

test("test_find_row_index_of_an_instant_older_than_every_row_returns_the_last_row", () => {
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), "2026-11-13T07:00:00.000Z"), 2);
});

test("test_find_row_index_of_an_instant_newer_than_every_row_returns_zero", () => {
    assert.equal(findRulerRowIndexForInstant(buildThreeRows(), INSTANT_13), 0);
});

test("test_find_row_index_of_a_row_with_no_instants_throws", () => {
    // Scenario: row 0 is the reverse-mode "now" row with no instants.
    const rows = [buildRow("now", []), buildRow("r1", [INSTANT_10])];
    assert.throws(() => findRulerRowIndexForInstant(rows, INSTANT_10));
});

test("test_find_row_index_with_no_rows_throws", () => {
    assert.throws(() => findRulerRowIndexForInstant([], INSTANT_10));
});

test("test_percent_of_the_first_row_is_zero_and_of_the_last_row_is_one_hundred", () => {
    assert.equal(computeBarPercent(0, 5), 0);
    assert.equal(computeBarPercent(4, 5), 100);
    assert.equal(computeBarPercent(1, 5), 25);
});

test("test_percent_with_one_row_is_zero", () => {
    assert.equal(computeBarPercent(0, 1), 0);
});

test("test_marking_a_row_selected_puts_the_class_on_that_tick_only", () => {
    // Scenario: mark row 0 (the newest tick, last in the page).
    const ticksOldestFirst = buildRulerWithRows(buildThreeRows());
    markRealRulerRowSelected(0);
    const selectedFlags = ticksOldestFirst.map((tick) => tick.classList.contains(BARS_SELECTED_TICK_CLASS));
    assert.deepEqual(selectedFlags, [false, false, true]);
});

test("test_marking_another_row_selected_moves_the_class", () => {
    const ticksOldestFirst = buildRulerWithRows(buildThreeRows());
    markRealRulerRowSelected(0);
    markRealRulerRowSelected(2);
    const selectedFlags = ticksOldestFirst.map((tick) => tick.classList.contains(BARS_SELECTED_TICK_CLASS));
    assert.deepEqual(selectedFlags, [true, false, false]);
});

test("test_setting_the_ruler_loading_on_puts_the_loading_class_on_the_real_ruler", () => {
    buildRulerWithRows(buildThreeRows());
    setRealRulerLoading(true);
    assert.equal(document.getElementById("timelineRulerComponent")!.classList.contains(BARS_RULER_LOADING_CLASS), true);
});

test("test_setting_the_ruler_loading_off_removes_the_loading_class", () => {
    buildRulerWithRows(buildThreeRows());
    setRealRulerLoading(true);
    setRealRulerLoading(false);
    assert.equal(document.getElementById("timelineRulerComponent")!.classList.contains(BARS_RULER_LOADING_CLASS), false);
});

test("test_setting_the_ruler_loading_does_not_change_which_tick_is_selected", () => {
    const ticksOldestFirst = buildRulerWithRows(buildThreeRows());
    markRealRulerRowSelected(1);
    setRealRulerLoading(true);
    setRealRulerLoading(false);
    const selectedFlags = ticksOldestFirst.map((tick) => tick.classList.contains(BARS_SELECTED_TICK_CLASS));
    assert.deepEqual(selectedFlags, [false, true, false]);
});

test("test_selected_time_held_by_a_row_selects_that_row", () => {
    // Scenario: a time equal to an instant of row 1 selects row 1.
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), INSTANT_10), 1);
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), INSTANT_12), 0);
});

test("test_selected_time_inside_a_merged_row_selects_that_row", () => {
    // Scenario: a time between the first and last instant of row 1 selects row 1.
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), "2026-11-13T10:15:00.000Z"), 1);
});

test("test_selected_time_between_two_rows_selects_the_older_row", () => {
    // Scenario: 11:00 is after row 1 (10:30) and before row 0 (12:00): the older row 1 is selected.
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), INSTANT_11), 1);
});

test("test_selected_time_older_than_every_row_selects_the_oldest_row", () => {
    // Scenario: a time before 08:00 selects the last row.
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), "2026-11-13T07:00:00.000Z"), 2);
});

test("test_selected_time_newer_than_every_row_selects_the_newest_row", () => {
    // Scenario: a time after 12:00 selects row 0.
    assert.equal(findRulerRowIndexForSelectedTime(buildThreeRows(), INSTANT_13), 0);
});

test("test_selected_time_with_no_rows_throws", () => {
    // Scenario: an empty row list has no row to select.
    assert.throws(() => findRulerRowIndexForSelectedTime([], INSTANT_10));
});
