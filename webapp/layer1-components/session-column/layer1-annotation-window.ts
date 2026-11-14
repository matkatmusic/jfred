// Task 382: pure placement of session records on the axis, and the window of them near the viewport.

import { computeAxisPixelsAt } from "../bubbles/layer1-ranges.ts";
import type { WireAnnotation, WireSessionSpan } from "./layer1-wire-annotations.ts";
import type { SessionPixelSpan } from "./layer1-session-lanes.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";
import { buildDotLineKey } from "./layer1-session-slots.ts";

// How far past the viewport edge the column keeps drawing records.
export const ANNOTATION_MARGIN_PX = 300;

export interface Placement {
  annotation: WireAnnotation;
  axisPx: number;
  // How many records at this same offset come before it; the column shifts it right per step.
  stack: number;
}

function computeStack(previous: Placement | undefined, axisPx: number): number {
  if (previous === undefined) {
    return 0;
  }
  if (previous.axisPx !== axisPx) {
    return 0;
  }
  return previous.stack + 1;
}

export function computeAnnotationPlacements(list: readonly WireAnnotation[], ticks: readonly WireRulerTick[]): Placement[] {
  const placements: Placement[] = [];
  if (ticks.length === 0) {
    return placements;
  }
  const lastBySession = new Map<string, Placement>();
  for (const annotation of list) {
    const axisPx = computeAxisPixelsAt(Date.parse(annotation.instant), ticks);
    const stack = computeStack(lastBySession.get(annotation.sessionId), axisPx);
    const placement = { annotation, axisPx, stack };
    lastBySession.set(annotation.sessionId, placement);
    placements.push(placement);
  }
  return placements;
}

export type PairSpan = [Placement, Placement];

// function groupPlacementsByPair(list: readonly Placement[]): Map<string, Placement[]> {
//   const membersByPair = new Map<string, Placement[]>();
//   for (const placement of list) {
//     const pairId = placement.annotation.pairId;
//     if (pairId !== undefined) {
//       membersByPair.set(pairId, [...(membersByPair.get(pairId) ?? []), placement]);
//     }
//   }
//   return membersByPair;
// }

type ReadPlacementKey = (placement: Placement) => string | undefined;

function readPairKey(placement: Placement): string | undefined {
  return placement.annotation.pairId;
}

function readSessionKey(placement: Placement): string | undefined {
  return placement.annotation.sessionId;
}

function collectPlacementsByKey(list: readonly Placement[], readKey: ReadPlacementKey): Map<string, Placement[]> {
  const membersByKey = new Map<string, Placement[]>();
  for (const placement of list) {
    const key = readKey(placement);
    if (key !== undefined) {
      membersByKey.set(key, [...(membersByKey.get(key) ?? []), placement]);
    }
  }
  return membersByKey;
}

// One span per key, first record to last; a lone record gives a zero-height span.
export function listSpansByKey(list: readonly Placement[], readKey: ReadPlacementKey): PairSpan[] {
  const spans: PairSpan[] = [];
  for (const members of collectPlacementsByKey(list, readKey).values()) {
    spans.push([members[0]!, members[members.length - 1]!]);
  }
  return spans;
}

// A pair with two or more records gets one span.
export function listPairSpans(list: readonly Placement[]): PairSpan[] {
  const pairSpans: PairSpan[] = [];
  for (const span of listSpansByKey(list, readPairKey)) {
    const isLonePlacement = span[0] === span[1];
    if (!isLonePlacement) {
      pairSpans.push(span);
    }
  }
  return pairSpans;
}

export function listSessionSpans(list: readonly Placement[]): PairSpan[] {
  return listSpansByKey(list, readSessionKey);
}

function isSpanInsideRuler(span: WireSessionSpan, ticks: readonly WireRulerTick[]): boolean {
  const firstTickMs = Date.parse(ticks[0]!.instant);
  const lastTickMs = Date.parse(ticks[ticks.length - 1]!.instant);
  const spanFirstMs = Date.parse(span.first);
  const spanLastMs = Date.parse(span.last);
  if (spanLastMs < firstTickMs) {
    return false;
  }
  if (spanFirstMs > lastTickMs) {
    return false;
  }
  return true;
}

// The ruler's first and last tick bound what can be drawn: a session wholly outside it would pile on one pixel.
export function listSessionPixelSpansFromServer(spans: readonly WireSessionSpan[], ticks: readonly WireRulerTick[]): SessionPixelSpan[] {
  const pixelSpans: SessionPixelSpan[] = [];
  for (const span of spans) {
    if (isSpanInsideRuler(span, ticks)) {
      const firstPx = computeAxisPixelsAt(Date.parse(span.first), ticks);
      const lastPx = computeAxisPixelsAt(Date.parse(span.last), ticks);
      pixelSpans.push({ sessionId: span.sessionId, firstPx, lastPx });
    }
  }
  return pixelSpans;
}

export function listSessionPixelSpansFromPlacements(spans: readonly PairSpan[]): SessionPixelSpan[] {
  const pixelSpans: SessionPixelSpan[] = [];
  for (const [first, last] of spans) {
    pixelSpans.push({ sessionId: first.annotation.sessionId, firstPx: first.axisPx, lastPx: last.axisPx });
  }
  return pixelSpans;
}

export function listWindowPlacements(placements: readonly Placement[], topPx: number, bottomPx: number): Placement[] {
  const kept: Placement[] = [];
  for (const placement of placements) {
    const isBelowTop = placement.axisPx >= topPx;
    const isAboveBottom = placement.axisPx <= bottomPx;
    const isInside = isBelowTop && isAboveBottom;
    if (isInside) {
      kept.push(placement);
    }
  }
  return kept;
}

// One placement per (session, y) that has extra dots: the one with the largest stack.
export function listConnectorPlacements(list: readonly Placement[]): Placement[] {
  const widestByLine = new Map<string, Placement>();
  for (const placement of list) {
    const key = buildDotLineKey(placement.annotation.sessionId, placement.axisPx);
    const widestStack = widestByLine.get(key)?.stack ?? 0;
    if (placement.stack > widestStack) {
      widestByLine.set(key, placement);
    }
  }
  return [...widestByLine.values()];
}
