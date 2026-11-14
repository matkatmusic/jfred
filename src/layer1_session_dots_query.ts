// Task 888 step 14: sort the kept dots, give each session its span, answer a range query.

import type { Layer1WireAnnotation, Layer1WireSessionSpan, SessionDotIndex } from "./layer1_session_dots_types.ts";

function compareDotsByInstant(left: Layer1WireAnnotation, right: Layer1WireAnnotation): number {
  return left.instant.getTime() - right.instant.getTime();
}

function compareSpansByFirstThenSessionId(left: Layer1WireSessionSpan, right: Layer1WireSessionSpan): number {
  const firstDifference = left.first.getTime() - right.first.getTime();
  if (firstDifference !== 0) {
    return firstDifference;
  }
  const leftId = left.sessionId.toString();
  const rightId = right.sessionId.toString();
  if (leftId < rightId) {
    return -1;
  }
  if (leftId > rightId) {
    return 1;
  }
  return 0;
}

// Array.sort is stable, so equal instants keep their input order.
export function sortDotsByInstant(dots: Layer1WireAnnotation[]): Layer1WireAnnotation[] {
  const copy = [...dots];
  copy.sort(compareDotsByInstant);
  return copy;
}

function extendSessionSpan(spansBySessionId: Map<string, Layer1WireSessionSpan>, dot: Layer1WireAnnotation): void {
  const key = dot.sessionId.toString();
  const span = spansBySessionId.get(key);
  if (span === undefined) {
    spansBySessionId.set(key, { sessionId: dot.sessionId, first: dot.instant, last: dot.instant });
    return;
  }
  span.last = dot.instant;
}

export function computeSessionSpans(sortedDots: readonly Layer1WireAnnotation[]): Layer1WireSessionSpan[] {
  const spansBySessionId = new Map<string, Layer1WireSessionSpan>();
  for (const dot of sortedDots) {
    extendSessionSpan(spansBySessionId, dot);
  }
  const spans = Array.from(spansBySessionId.values());
  spans.sort(compareSpansByFirstThenSessionId);
  return spans;
}

// Smallest index whose instant is at or after targetMs (dots.length when none).
function findFirstIndexAtOrAfter(dots: readonly Layer1WireAnnotation[], targetMs: number): number {
  let low = 0;
  let high = dots.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dots[middle]!.instant.getTime() < targetMs) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

// Smallest index whose instant is after targetMs (dots.length when none).
function findFirstIndexAfter(dots: readonly Layer1WireAnnotation[], targetMs: number): number {
  let low = 0;
  let high = dots.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dots[middle]!.instant.getTime() <= targetMs) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

export function listDotsInRange(sortedDots: readonly Layer1WireAnnotation[], from: Date, to: Date): Layer1WireAnnotation[] {
  const start = findFirstIndexAtOrAfter(sortedDots, from.getTime());
  const end = findFirstIndexAfter(sortedDots, to.getTime());
  if (end <= start) {
    return [];
  }
  return sortedDots.slice(start, end);
}

export function buildSessionDotIndex(dots: Layer1WireAnnotation[]): SessionDotIndex {
  const sortedDots = sortDotsByInstant(dots);
  return { dots: sortedDots, sessionSpans: computeSessionSpans(sortedDots) };
}
