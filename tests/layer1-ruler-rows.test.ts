// Tasks 268 and 275: which ruler ENTRIES become printed gutter ROWS, and what each row reads.
//
// TWO reasons an entry loses its own row, kept distinguishable below: its label repeats the row
// above (task 268), or it would overprint that row (TICK_LABEL_MIN_GAP_PX). Either way the
// surviving row absorbs the folded entry's event count, so a merge cannot under-report.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TICK_LABEL_MIN_GAP_PX,
    formatInstantLabel,
    listRulerRows,
} from "../webapp/layer1-ruler-rows.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// Offsets are STATED, never derived — the axis resolver has its own tests.
function makeTick(instant: string, axisPx: number, eventCount: number): WireRulerTick {
    return { instant, axisPx, eventCount };
}

test("test_formatInstantLabel_prints_month_day_time_to_hundredths", () => {
    // Task 276: the third millisecond digit is dropped, not rounded.
    const label = formatInstantLabel("2026-07-18T19:42:08.229Z");
    assert.equal(label, "07-18 19:42:08.22");
});

test("test_listRulerRows_prints_the_event_count_after_each_label", () => {
    // Task 275: the count comes off the wire — the page derives it from nothing.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 6),
        makeTick("2026-07-19T08:00:00.000Z", 40, 1),
    ]);
    assert.deepEqual(rows.map((row) => row.text), ["07-18 19:42:08.22 (6)", "07-19 08:00:00.00 (1)"]);
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 40]);
});

test("test_listRulerRows_keeps_every_entry_whose_label_differs", () => {
    // A merge seeded with a value equal to the first label would swallow row one and still pass
    // every duplicate test below.
    const rows = listRulerRows([
        makeTick("2026-06-01T09:00:00.000Z", 0, 1),
        makeTick("2026-06-01T09:00:01.000Z", 22, 2),
        makeTick("2026-06-01T09:00:02.000Z", 44, 3),
    ]);
    assert.deepEqual(rows.map((row) => row.text),
        ["06-01 09:00:00.00 (1)", "06-01 09:00:01.00 (2)", "06-01 09:00:02.00 (3)"]);
});

test("test_listRulerRows_merges_entries_that_print_the_same_label_and_sums_their_counts", () => {
    // Task 268: the entries are 22 px apart, so the pixel guard cannot be what merges them.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 4),
        makeTick("2026-07-18T19:42:08.225Z", 22, 1),
        makeTick("2026-07-18T19:42:08.229Z", 44, 2),
        makeTick("2026-07-18T19:42:08.230Z", 66, 5),
    ]);
    // A merged row that kept its own count would under-report the moment it now stands for.
    assert.deepEqual(rows.map((row) => row.text), ["07-18 19:42:08.22 (7)", "07-18 19:42:08.23 (5)"]);
    // The surviving row sits at the EARLIEST merged offset, which is where a click navigates.
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 66]);
});

test("test_listRulerRows_folds_a_tick_that_would_overprint_the_row_above_it", () => {
    // DIFFERENT labels here, so this proves the pixel branch rather than task 268's same-label one.
    const rows = listRulerRows([
        makeTick("2026-06-01T09:00:00.000Z", 0, 1),
        makeTick("2026-06-01T10:36:00.000Z", 4, 3),
        makeTick("2026-06-01T14:36:00.000Z", 14, 1),
    ]);
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 14]);
    // The folded entry's 3 events were ABSORBED by the row above it, not discarded.
    assert.deepEqual(rows.map((row) => row.text), ["06-01 09:00:00.00 (4)", "06-01 14:36:00.00 (1)"]);
    // The surviving gap is measured against the DRAWN row, not the folded entry.
    assert.ok(14 - 0 >= TICK_LABEL_MIN_GAP_PX);
    assert.ok(4 - 0 < TICK_LABEL_MIN_GAP_PX);
});

test("test_listRulerRows_refuses_an_entry_with_no_event_count", () => {
    // A missing count is a producer bug: it must fail loudly, not print "(undefined)" or "(NaN)".
    const malformed = { instant: "2026-06-01T09:00:00.000Z", axisPx: 0 } as WireRulerTick;
    // the entry is named in the refusal, so the offending instant is identifiable.
    assert.throws(() => listRulerRows([malformed]), /carries no event count/);
});
