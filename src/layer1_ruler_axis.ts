// Capped-gap ruler axis (task 234, spec S18 "Ruler scale — capped linear" / "Ruler bounds"):
// the ruler's ordered set of DISTINCT instants — every commit instant plus every disk mtime —
// resolved once, globally, to pixel offsets. Position is linear in elapsed time at 2.5 px per
// hour, except that any single gap between adjacent instants renders at most 24 px, so a
// months-long history still fits one screen while short gaps keep their proportion. The cap
// ACCUMULATES (offset i depends on every earlier gap), which is why this cannot be expressed in
// CSS the way S8's `--axis-ms` is — the page is handed finished offsets. Bounds fall out of the
// same ordered set: the first entry is the start (a disk orphan predating the first commit
// legitimately moves the start earlier) and the last is the end.

import type { Instant } from "./layered_types.ts";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// User-locked 2026-07-25: 2.5 px per hour of elapsed time.
export const RULER_PIXELS_PER_HOUR = 2.5;

// User-locked 2026-07-25: no single gap renders wider than 24 px (0.25" at 96 dpi).
export const RULER_GAP_CAP_PIXELS = 24;

// One instant's resolved place on the ruler.
export interface RulerPosition {
    instant: Instant;
    offsetPx: number;
}

// How far one gap advances the ruler: linear in elapsed time, clamped to the cap.
function measureGapPixels(earlier: Instant, later: Instant): number {
    const elapsedHours = (later.getTime() - earlier.getTime()) / MILLISECONDS_PER_HOUR;
    return Math.min(elapsedHours * RULER_PIXELS_PER_HOUR, RULER_GAP_CAP_PIXELS);
}

// De-duplicate (the same moment is one position) and sort ascending.
function orderDistinctInstants(instants: Instant[]): Instant[] {
    const byEpochMs = new Map<number, Instant>();
    for (const instant of instants) {
        byEpochMs.set(instant.getTime(), instant);
    }
    return [...byEpochMs.values()].sort((a, b) => a.getTime() - b.getTime());
}

// Resolve the ruler's instants to accumulated pixel offsets, earliest at 0.
export function resolveInstantOffsets(instants: Instant[]): RulerPosition[] {
    let offsetPx = 0;
    let previous: Instant | undefined = undefined;
    return orderDistinctInstants(instants).map((instant) => {
        offsetPx += previous === undefined ? 0 : measureGapPixels(previous, instant);
        previous = instant;
        return { instant, offsetPx };
    });
}
