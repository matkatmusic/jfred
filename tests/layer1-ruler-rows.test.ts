// Tasks 268/275: a row drops when its label repeats or overprints the row above; the survivor absorbs its count.

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

test("test_formatInstantLabel_prints_month_day_time_to_milliseconds", () => {
    // Task 306: full ms precision, so distinct instants never share a label.
    const label = formatInstantLabel("2026-07-18T19:42:08.229Z");
    assert.equal(label, "07-18 19:42:08.229");
});

test("test_listRulerRows_prints_the_event_count_after_each_label", () => {
    // Task 275: the count comes off the wire — the page derives it from nothing.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 6),
        makeTick("2026-07-19T08:00:00.000Z", 40, 1),
    ]);
    assert.deepEqual(rows.map((row) => row.text), ["07-18 19:42:08.220 (6)", "07-19 08:00:00.000 (1)"]);
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 40]);
});

test("test_listRulerRows_keeps_every_entry_whose_label_differs", () => {
    // A merge seeded equal to the first label would swallow row one yet still pass every duplicate test below.
    const rows = listRulerRows([
        makeTick("2026-06-01T09:00:00.000Z", 0, 1),
        makeTick("2026-06-01T09:00:01.000Z", 22, 2),
        makeTick("2026-06-01T09:00:02.000Z", 44, 3),
    ]);
    assert.deepEqual(rows.map((row) => row.text),
        ["06-01 09:00:00.000 (1)", "06-01 09:00:01.000 (2)", "06-01 09:00:02.000 (3)"]);
});

test("test_listRulerRows_keeps_distinct_millisecond_instants_on_their_own_rows", () => {
    // Task 306: these merged under centisecond labels; at ms precision each keeps its own row.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 4),
        makeTick("2026-07-18T19:42:08.225Z", 22, 1),
        makeTick("2026-07-18T19:42:08.229Z", 44, 2),
        makeTick("2026-07-18T19:42:08.230Z", 66, 5),
    ]);
    assert.deepEqual(rows.map((row) => row.text),
        ["07-18 19:42:08.220 (4)", "07-18 19:42:08.225 (1)", "07-18 19:42:08.229 (2)", "07-18 19:42:08.230 (5)"]);
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 22, 44, 66]);
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
    assert.deepEqual(rows.map((row) => row.text), ["06-01 09:00:00.000 (4)", "06-01 14:36:00.000 (1)"]);
    // The surviving gap is measured against the DRAWN row, not the folded entry.
    assert.ok(14 - 0 >= TICK_LABEL_MIN_GAP_PX);
    assert.ok(4 - 0 < TICK_LABEL_MIN_GAP_PX);
});

test("test_listRulerRows_gives_the_reported_cluster_one_label_per_instant", () => {
    // Task 306 fix: the demo-corrupt cluster prints one label per instant, so every leader lands on one.
    const rows = listRulerRows([
        { instant: "2026-07-20T19:19:03.441Z", axisPx: 0, eventCount: 1 },
        { instant: "2026-07-20T19:19:03.443Z", axisPx: 22, eventCount: 1 },
        { instant: "2026-07-20T19:19:03.446Z", axisPx: 44, eventCount: 1 },
    ]);
    assert.deepEqual(rows.map((row) => row.text),
        ["07-20 19:19:03.441 (1)", "07-20 19:19:03.443 (1)", "07-20 19:19:03.446 (1)"]);
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 22, 44]);
});

test("test_listRulerRows_refuses_an_entry_with_no_event_count", () => {
    // A missing count is a producer bug: it must fail loudly, not print "(undefined)" or "(NaN)".
    const malformed = { instant: "2026-06-01T09:00:00.000Z", axisPx: 0 } as WireRulerTick;
    // the entry is named in the refusal, so the offending instant is identifiable.
    assert.throws(() => listRulerRows([malformed]), /carries no event count/);
});
