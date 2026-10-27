// Folds Layer 1 ruler entries (distinct instants) into the printed gutter rows (tasks 268, 275, 306).

import type { WireRulerTick } from "./layer1-wire.ts";

// Minimum vertical distance between two tick LABELS, in px (the mockup's collision skip).
// ponytail: currently UNREACHABLE in Layer 1 — task 251's content floor gives every adjacent pair of entries at least RULER_NODE_ROW_PIXELS, and the smallest gap this repo renders is exactly 22 px. Kept as the guard it was written to be: lower that floor and labels overprint again.
export const TICK_LABEL_MIN_GAP_PX = 13;

// "MM-DD HH:MM:SS.mmm" in UTC. Task 306: full milliseconds, so distinct instants never print the same label.
export function formatInstantLabel(instant: string): string {
  const isoText = new Date(instant).toISOString();
  const monthToMillisecond = isoText.slice(5, 23);
  return monthToMillisecond.replace("T", " ");
}

// One printed gutter row: where it sits, what it reads, and every entry it stands for.
export interface RulerRow {
  axisPx: number;
  text: string;
  // Task 284: every ABSORBED entry's offset, this row's own first, so an expansion sees them all.
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

// A missing event count is a producer bug (computeNodeLadderLayout measures it); fail loudly, never print NaN.
function readEventCount(tick: WireRulerTick): number {
  const hasEventCount = Number.isFinite(tick.eventCount);
  if (hasEventCount) {
    return tick.eventCount;
  }
  throw new Error(`ruler entry ${tick.instant} carries no event count`);
}

// Whether `tick` joins the row above: same printed text, then physical collision.
function isTickJoiningRow(previous: RowTally, tick: WireRulerTick, label: string): boolean {
  if (label === previous.label) {
    return true;
  }
  return tick.axisPx - previous.axisPx < TICK_LABEL_MIN_GAP_PX;
}

// Fold `tick` into the last opened row when it cannot hold one of its own, reporting whether it did.
function mergeTickIntoPreviousRow(tallies: RowTally[], tick: WireRulerTick, label: string): boolean {
  const previous = tallies.at(-1);
  if (previous === undefined) {
    return false;
  }
  const joinsPreviousRow = isTickJoiningRow(previous, tick, label);
  if (!joinsPreviousRow) {
    return false;
  }
  previous.eventCount += readEventCount(tick);
  previous.axisPxList.push(tick.axisPx);
  previous.instants.push(tick.instant);
  return true;
}

// The gutter's rows, in ruler order, each labelled "<timestamp> (<events>)" (task 275).
export function listRulerRows(ruler: WireRulerTick[]): RulerRow[] {
  const tallies: RowTally[] = [];
  for (const tick of ruler) {
    const label = formatInstantLabel(tick.instant);
    const wasMerged = mergeTickIntoPreviousRow(tallies, tick, label);
    if (wasMerged) {
      continue;
    }
    tallies.push({ axisPx: tick.axisPx, label, eventCount: readEventCount(tick), axisPxList: [tick.axisPx], instants: [tick.instant] });
  }
  const rows: RulerRow[] = [];
  for (const row of tallies) {
    rows.push({
      axisPx: row.axisPx,
      text: `${row.label} (${row.eventCount})`,
      axisPxList: row.axisPxList,
      instants: row.instants,
    });
  }
  return rows;
}
