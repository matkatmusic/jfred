// Tasks 268 and 275: which ruler ENTRIES become printed gutter ROWS, and what each row reads.
//
// Unit tests over `listRulerRows` rather than through the page, because the merge is arithmetic on
// wire data and needs no DOM at all — tests/layer1-page.test.ts still proves the rows reach the
// gutter. The overprint case here is the one that used to live there as
// `test_ruler_skips_a_tick_label_that_would_overprint_the_one_above_it`; it moved with the logic.
//
// TWO reasons an entry loses its own row, and they are kept distinguishable below: the label it
// would print repeats the row above it (task 268 — the common one, 247 of this repo's 683 entries),
// or it would physically overprint that row (TICK_LABEL_MIN_GAP_PX, which task 251's 22 px content
// floor has since made unreachable in Layer 1). Either way the surviving row absorbs the folded
// entry's event count, which is the assertion that stops a merge from silently under-reporting.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TICK_LABEL_MIN_GAP_PX,
    formatInstantLabel,
    listRulerRows,
} from "../webapp/layer1-ruler-rows.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// A ruler entry as the endpoint ships it. Offsets are STATED, never derived from the instants —
// the axis resolver has its own tests (tests/layer1-ruler-axis.test.ts).
function makeTick(instant: string, axisPx: number, eventCount: number): WireRulerTick {
    return { instant, axisPx, eventCount };
}

test("test_formatInstantLabel_prints_month_day_time_to_hundredths", () => {
    // Scenario (task 276): the label is the ISO string's "MM-DD HH:MM:SS.hh" slice in UTC — the
    // precision the user asked for, with the third millisecond digit dropped rather than rounded.
    // Steps:
    // format one instant carrying a full millisecond field.
    const label = formatInstantLabel("2026-07-18T19:42:08.229Z");
    // the year, the "T" and the trailing digit are all gone.
    assert.equal(label, "07-18 19:42:08.22");
});

test("test_listRulerRows_prints_the_event_count_after_each_label", () => {
    // Scenario (task 275, the user's words): "07-18 19:42:08.22 (6). this means there are six
    // events that occurred at that timestamp." The count comes off the wire — the page derives it
    // from nothing.
    // Steps:
    // two entries far enough apart to keep their own rows, carrying different counts.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 6),
        makeTick("2026-07-19T08:00:00.000Z", 40, 1),
    ]);
    // each row reads its own timestamp and its own count.
    assert.deepEqual(rows.map((row) => row.text), ["07-18 19:42:08.22 (6)", "07-19 08:00:00.00 (1)"]);
    // and each keeps the offset its entry arrived at, which is what the gutter positions it by.
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 40]);
});

test("test_listRulerRows_keeps_every_entry_whose_label_differs", () => {
    // Scenario: the merge must only ever collapse rows the reader cannot tell apart. Distinct
    // labels, comfortably clear of the collision threshold, must all survive — a merge rule seeded
    // with an initial value equal to the first label would swallow the first row and pass every
    // duplicate test below while destroying the ruler.
    // Steps:
    // three entries one second apart in time and 22 px apart on the axis.
    const rows = listRulerRows([
        makeTick("2026-06-01T09:00:00.000Z", 0, 1),
        makeTick("2026-06-01T09:00:01.000Z", 22, 2),
        makeTick("2026-06-01T09:00:02.000Z", 44, 3),
    ]);
    // all three are printed, each reporting only its own events.
    assert.deepEqual(rows.map((row) => row.text),
        ["06-01 09:00:00.00 (1)", "06-01 09:00:01.00 (2)", "06-01 09:00:02.00 (3)"]);
});

test("test_listRulerRows_merges_entries_that_print_the_same_label_and_sums_their_counts", () => {
    // Scenario (task 268, the user's words): "there are many ruler rows that have the same time
    // value ... rows with the same value should all be combined into one row." Since task 276 the
    // label carries hundredths, so this is instants inside ONE 10 ms bucket — routine, because
    // commit instants are second-precision while disk mtimes are millisecond-precision. The three
    // entries below are 22 px apart, so the pixel guard cannot be what merges them.
    // Steps:
    // three entries inside one 10 ms bucket, then a fourth in the next bucket.
    const rows = listRulerRows([
        makeTick("2026-07-18T19:42:08.220Z", 0, 4),
        makeTick("2026-07-18T19:42:08.225Z", 22, 1),
        makeTick("2026-07-18T19:42:08.229Z", 44, 2),
        makeTick("2026-07-18T19:42:08.230Z", 66, 5),
    ]);
    // the first three become ONE row, which reports 4 + 1 + 2 events rather than only its own 4 —
    // a merged row that kept its own count would under-report the moment it now stands for.
    assert.deepEqual(rows.map((row) => row.text), ["07-18 19:42:08.22 (7)", "07-18 19:42:08.23 (5)"]);
    // the surviving row sits at the EARLIEST merged entry's offset, which is the instant a click on
    // it navigates to (webapp/layer1-ruler-click.ts).
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 66]);
});

test("test_listRulerRows_folds_a_tick_that_would_overprint_the_row_above_it", () => {
    // Scenario (plans/layer1-mockup.html): at the locked 2.5 px/hour two nearby instants can
    // resolve within a few pixels, so an entry closer than 13 px to the last DRAWN row cannot have
    // a row of its own. DIFFERENT labels here, so this proves the pixel branch rather than task
    // 268's same-label branch.
    // Steps:
    // a ruler whose middle entry sits 4 px below the first and 10 px above the last.
    const rows = listRulerRows([
        makeTick("2026-06-01T09:00:00.000Z", 0, 1),
        makeTick("2026-06-01T10:36:00.000Z", 4, 3),
        makeTick("2026-06-01T14:36:00.000Z", 14, 1),
    ]);
    // the 4 px entry is folded; the 14 px one still clears 13 px from the 0 px row that DID draw.
    assert.deepEqual(rows.map((row) => row.axisPx), [0, 14]);
    // and the folded entry's 3 events were ABSORBED by the row above it, not discarded.
    assert.deepEqual(rows.map((row) => row.text), ["06-01 09:00:00.00 (4)", "06-01 14:36:00.00 (1)"]);
    // the gap that survived is measured against the DRAWN row, not the folded entry.
    assert.ok(14 - 0 >= TICK_LABEL_MIN_GAP_PX);
    assert.ok(4 - 0 < TICK_LABEL_MIN_GAP_PX);
});

test("test_listRulerRows_refuses_an_entry_with_no_event_count", () => {
    // Scenario: the count is measured by the same layout that measures the offsets, so an entry
    // without one is a bug in the producer — it must fail loudly rather than print "(undefined)"
    // or, once a merge adds it to a running total, "(NaN)".
    // Steps:
    // hand it an entry missing the field the wire type requires.
    const malformed = { instant: "2026-06-01T09:00:00.000Z", axisPx: 0 } as WireRulerTick;
    // the entry is named in the refusal, so the offending instant is identifiable.
    assert.throws(() => listRulerRows([malformed]), /carries no event count/);
});
