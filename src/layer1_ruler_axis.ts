// Floored-linear, capped ruler axis (task 234, spec S18 "Ruler scale — capped linear" /
// "Ruler bounds"): the ruler's ordered set of DISTINCT instants — every commit instant plus every
// disk mtime — resolved once, globally, to pixel offsets. Position is linear in elapsed time at
// 2.5 px per hour inside a band, with any single gap between adjacent instants rendering at least
// 16 px and at most 120 px. The cap keeps a months-long history on one screen; the FLOOR is what
// guarantees non-overlap — the `.node` dot is 15 px tall, so a gap of minutes would otherwise
// place two nodes on top of each other. Both clamps ACCUMULATE (offset i depends on every earlier
// gap), which is why this cannot be expressed in CSS the way S8's `--axis-ms` is — the page is
// handed finished offsets. Bounds fall out of the same ordered set: the first entry is the start
// (a disk orphan predating the first commit legitimately moves the start earlier) and the last is
// the end.

import type { Instant } from "./layered_types.ts";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// User-locked 2026-07-25: 2.5 px per hour of elapsed time.
export const RULER_PIXELS_PER_HOUR = 2.5;

// User-locked 2026-07-25: no single gap renders wider than 120 px. Raised from 24 with the
// 16 px floor below — at the old cap every gap would have collapsed into the 16–24 px band
// and the axis would have read as an ordered list rather than a time axis.
export const RULER_GAP_CAP_PIXELS = 120;

// User-locked 2026-07-25: no single gap renders narrower than 16 px. The `.node` dot is
// 15 px tall, so anything smaller lets two adjacent nodes overprint — the reported defect.
// Applied HERE rather than per-lane in the page so a node's y never stops meaning its
// instant's position on the shared ruler.
export const RULER_MIN_GAP_PIXELS = 16;

// One instant's resolved place on the ruler.
export interface RulerPosition {
    instant: Instant;
    offsetPx: number;
}

// How far one gap advances the ruler: linear in elapsed time, clamped to the floor and the cap.
function measureGapPixels(earlier: Instant, later: Instant): number {
    const elapsedHours = (later.getTime() - earlier.getTime()) / MILLISECONDS_PER_HOUR;
    const linearPixels = elapsedHours * RULER_PIXELS_PER_HOUR;
    return Math.min(Math.max(linearPixels, RULER_MIN_GAP_PIXELS), RULER_GAP_CAP_PIXELS);
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
