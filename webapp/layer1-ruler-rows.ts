// What the Layer 1 ruler gutter actually DRAWS (tasks 268 and 275). Split out of webapp/layer1-page.ts because that file is at the 250-line cap and because the merge below is real branching logic that deserves a test of its own.
//
// A ruler ENTRY is not a ruler ROW. The wire carries one entry per distinct instant, and layer1-page.ts's renderLeaderLines still draws a dashed line for every one of them — bubbles sit on the entries whose label is folded away, so dropping their line would leave those bubbles with no connector. A ROW is what the gutter PRINTS, and two entries share a row when the gutter cannot tell them apart:
//
// * they render the SAME text. Since task 276 the label is "MM-DD HH:MM:SS.hh", so this is two instants inside one 10 ms bucket — routine rather than rare, because commit instants are second-precision while disk mtimes are millisecond-precision. Measured over this repo: 247 of 683 entries repeat the label above them, and merging leaves 436 rows. That is task 268, and the merge is on the DISPLAYED STRING because the user's phrasing ties it to what the label shows.  * or they would physically overprint (TICK_LABEL_MIN_GAP_PX).
//
// Either way the surviving row ABSORBS the folded entry's event count. A merged row that reported only its own count would silently under-report the moment it now stands for.

import type { WireRulerTick } from "./layer1-wire.ts";

// Minimum vertical distance between two tick LABELS, in px (the mockup's collision skip).
// ponytail: currently UNREACHABLE in Layer 1 — task 251's content floor gives every adjacent pair of entries at least RULER_NODE_ROW_PIXELS, and the smallest gap this repo renders is exactly 22 px. Kept as the guard it was written to be: lower that floor and labels overprint again.
export const TICK_LABEL_MIN_GAP_PX = 13;

// The tick/row label: "MM-DD HH:MM:SS.hh" in UTC. Task 276: the slice used to stop at 16, which cut the label at minutes — so two instants seconds apart rendered as the SAME text and their rows read as duplicates. 22 is the ISO string's index after the second millisecond digit, which is the precision the user asked for ("07-18 19:42:08.22"); the third digit is dropped rather than rounded because this is a label, not a value anything is computed from.
export function formatInstantLabel(instant: string): string {
    return new Date(instant).toISOString().slice(5, 22).replace("T", " ");
}

// One printed gutter row: where it sits, what it reads, and every entry it stands for.
export interface RulerRow {
    axisPx: number;
    text: string;
    // Task 284: the offsets of every ABSORBED entry, this row's own first. A merged row stands for several instants, and an expansion built from `axisPx` alone could only ever see the surviving entry's own events — under-reporting the row exactly the way its count used to.
    axisPxList: number[];
    // Task 300: absorbed instants, parallel to axisPxList; the LAST carries an expansion's extra height.
    instants: string[];
}

// One row while it is still collecting entries, before its count is spelled into its text.
interface RowTally {
    axisPx: number;
    label: string;
    eventCount: number;
    axisPxList: number[];
    instants: string[];
}

// One entry's event count. Every ruler entry is produced by layOutNodeLadders, which measures the count from the SAME ladders it measures the offsets from, so a missing one is a bug in the producer rather than bad input — fail loudly instead of printing "(undefined)" or, once a merge adds it to a running total, "(NaN)". Same rule as layer1-filter.ts's placeOrphanOnAxis and src/viewer_api_layer1.ts's placeInstantOnAxis on the same class of miss.
function readEventCount(tick: WireRulerTick): number {
    if (Number.isFinite(tick.eventCount)) {
        return tick.eventCount;
    }
    throw new Error(`ruler entry ${tick.instant} carries no event count`);
}

// Whether `tick` has to join the row above it rather than opening one of its own. Two separate reasons, tested one at a time: same printed text, then physical collision.
function tickJoinsRow(previous: RowTally, tick: WireRulerTick, label: string): boolean {
    if (label === previous.label) {
        return true;
    }
    return tick.axisPx - previous.axisPx < TICK_LABEL_MIN_GAP_PX;
}

// Fold `tick` into the row above it when it cannot hold one of its own, reporting whether it did.  `ruler` arrives ascending, so the only row a tick can ever join is the last one opened.
function absorbIntoPreviousRow(tallies: RowTally[], tick: WireRulerTick, label: string): boolean {
    const previous = tallies.at(-1);
    if (previous === undefined) {
        return false;
    }
    if (!tickJoinsRow(previous, tick, label)) {
        return false;
    }
    previous.eventCount += readEventCount(tick);
    previous.axisPxList.push(tick.axisPx);
    previous.instants.push(tick.instant);
    return true;
}

// The gutter's rows, in ruler order, each labelled "<timestamp> (<events>)" (task 275 — the count is measured by webapp/layer1-ruler-axis.ts, so the page still does no arithmetic over instants).
export function listRulerRows(ruler: WireRulerTick[]): RulerRow[] {
    const tallies: RowTally[] = [];
    for (const tick of ruler) {
        const label = formatInstantLabel(tick.instant);
        if (absorbIntoPreviousRow(tallies, tick, label)) {
            continue;
        }
        tallies.push({ axisPx: tick.axisPx, label, eventCount: readEventCount(tick), axisPxList: [tick.axisPx], instants: [tick.instant] });
    }
    return tallies.map((row) => ({
        axisPx: row.axisPx,
        text: `${row.label} (${row.eventCount})`,
        axisPxList: row.axisPxList,
        instants: row.instants,
    }));
}
