import type { WireRulerTick } from "../../layer1-wire.ts";

export interface TopRowAnchor {
  instant: string;
  offsetPx: number;
}

export function findTopRowAnchor(ticks: readonly WireRulerTick[], topAxisPx: number): TopRowAnchor {
  for (const tick of ticks) {
    const isAtOrBelowTop = tick.axisPx >= topAxisPx;
    if (isAtOrBelowTop) {
      return { instant: tick.instant, offsetPx: tick.axisPx - topAxisPx };
    }
  }
  const lastTick = ticks[ticks.length - 1]!;
  return { instant: lastTick.instant, offsetPx: lastTick.axisPx - topAxisPx };
}

export function computeAnchoredTopAxisPx(anchor: TopRowAnchor, ticks: readonly WireRulerTick[]): number {
  for (const tick of ticks) {
    const isAnchorTick = tick.instant === anchor.instant;
    if (isAnchorTick) {
      return tick.axisPx - anchor.offsetPx;
    }
  }
  throw new Error(`scroll anchor ${anchor.instant} is missing from the ruler`);
}
