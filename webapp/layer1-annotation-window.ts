// Task 382: pure placement of session records on the axis, and the window of them near the viewport.

import { computeAxisPixelsAt } from "./layer1-ranges.ts";
import type { WireAnnotation } from "./layer1-wire-annotations.ts";
import type { WireRulerTick } from "./layer1-wire.ts";

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

export function placeAnnotations(list: readonly WireAnnotation[], ticks: readonly WireRulerTick[]): Placement[] {
  const placements: Placement[] = [];
  if (ticks.length === 0) {
    return placements;
  }
  for (const annotation of list) {
    const axisPx = computeAxisPixelsAt(Date.parse(annotation.instant), ticks);
    const stack = computeStack(placements[placements.length - 1], axisPx);
    placements.push({ annotation, axisPx, stack });
  }
  return placements;
}

export type PairSpan = [Placement, Placement];

function groupPlacementsByPair(list: readonly Placement[]): Map<string, Placement[]> {
  const membersByPair = new Map<string, Placement[]>();
  for (const placement of list) {
    const pairId = placement.annotation.pairId;
    if (pairId !== undefined) {
      membersByPair.set(pairId, [...(membersByPair.get(pairId) ?? []), placement]);
    }
  }
  return membersByPair;
}

// A pair with two or more records gets one span, from its first record to its last.
export function listPairSpans(list: readonly Placement[]): PairSpan[] {
  const spans: PairSpan[] = [];
  for (const members of groupPlacementsByPair(list).values()) {
    if (members.length > 1) {
      spans.push([members[0]!, members[members.length - 1]!]);
    }
  }
  return spans;
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
