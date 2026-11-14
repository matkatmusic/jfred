// The instants the visible ruler rows cover, one row past each edge.
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";

export interface InstantRange {
  from: string;
  to: string;
}

// First row at or below topPx; rows.length when none.
function findFirstRowIndexAtOrBelow(rows: readonly RulerRow[], topPx: number): number {
  for (const [index, row] of rows.entries()) {
    const isBelowTop = row.axisPx >= topPx;
    if (isBelowTop) {
      return index;
    }
  }
  return rows.length;
}

// Last row at or above bottomPx; -1 when none.
function findLastRowIndexAtOrAbove(rows: readonly RulerRow[], bottomPx: number): number {
  for (let index = rows.length - 1; index >= 0; index--) {
    const isAboveBottom = rows[index]!.axisPx <= bottomPx;
    if (isAboveBottom) {
      return index;
    }
  }
  return -1;
}

// Earliest and latest instant over rows[startIndex..endIndex]; the caller guarantees at least one instant.
function measureInstantRange(rows: readonly RulerRow[], startIndex: number, endIndex: number): InstantRange {
  let from = rows[startIndex]!.instants[0]!;
  let to = from;
  for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex++) {
    for (const instant of rows[rowIndex]!.instants) {
      const isEarlier = Date.parse(instant) < Date.parse(from);
      if (isEarlier) {
        from = instant;
      }
      const isLater = Date.parse(instant) > Date.parse(to);
      if (isLater) {
        to = instant;
      }
    }
  }
  return { from, to };
}

// The widest instants new Date() reads; the server accepts both (src/viewer_api_layer1_session_dots.ts).
export const EARLIEST_INSTANT = new Date(-8.64e15).toISOString();
export const LATEST_INSTANT = new Date(8.64e15).toISOString();

// Session layout: the first row owns every earlier dot and the last row every later dot.
function reachEdgeDots(range: InstantRange, startIndex: number, endIndex: number, rowCount: number): InstantRange {
  const from = startIndex === 0 ? EARLIEST_INSTANT : range.from;
  const to = endIndex === rowCount - 1 ? LATEST_INSTANT : range.to;
  return { from, to };
}

// export function computeVisibleInstantRange(rows: readonly RulerRow[], topPx: number, bottomPx: number): InstantRange | undefined {
export function computeVisibleInstantRange(rows: readonly RulerRow[], topPx: number, bottomPx: number, isSessionLayout = false): InstantRange | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const startIndex = Math.max(0, findFirstRowIndexAtOrBelow(rows, topPx) - 1);
  const endIndex = Math.min(rows.length - 1, findLastRowIndexAtOrAbove(rows, bottomPx) + 1);
  const range = measureInstantRange(rows, startIndex, endIndex);
  if (!isSessionLayout) {
    return range;
  }
  return reachEdgeDots(range, startIndex, endIndex, rows.length);
  // return measureInstantRange(rows, startIndex, endIndex);
}
