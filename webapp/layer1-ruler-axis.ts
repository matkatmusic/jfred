// Lives in webapp/ so the endpoint and client-side folder filter share one copy of the gap arithmetic, avoiding drift.

// Re-declared rather than imported from src/layered_types.ts: tsconfig.webapp.json's rootDir is "webapp", so even a type-only src/ import is rejected.
type Instant = Date;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// User-locked 2026-07-25.
export const RULER_PIXELS_PER_HOUR = 2.5;

// User-locked 2026-07-25: keeps a months-long history on one screen.
export const RULER_GAP_CAP_PIXELS = 120;

// User-locked 2026-07-25: the `.node` dot is 15 px tall, so smaller gaps let nodes overprint; a measured ladder outranks this.
export const RULER_MIN_GAP_PIXELS = 16;

// Derived from webapp/layer1.html: 20 px outer dot + 2 px hairline; redo if node size, ring, or label font changes.
export const RULER_NODE_ROW_PIXELS = 22;

export interface RulerPosition {
    instant: Instant;
    offsetPx: number;
    // Deliberately NOT countRowsPerInstant's per-ladder MAX: that measures spacing demand, this counts events (task 275).
    eventCount: number;
}

// One bubble's nodes on the axis, in draw order; a bucket row is a one-instant ladder that bounds the ruler.
export type NodeLadder = Instant[];

export interface RulerLayout {
    ticks: RulerPosition[];
    // Parallel to the ladders handed in, not keyed by instant, since a ladder's two nodes can share instant yet differ.
    ladderOffsetsPx: number[][];
}

// Content only ever pushes entries further apart, so the row demand outranks the cap.
function measureGapPixels(earlier: Instant, later: Instant, contentFloorPx: number): number {
    const elapsedHours = (later.getTime() - earlier.getTime()) / MILLISECONDS_PER_HOUR;
    const linearPixels = elapsedHours * RULER_PIXELS_PER_HOUR;
    const clampedPixels = Math.min(Math.max(linearPixels, RULER_MIN_GAP_PIXELS), RULER_GAP_CAP_PIXELS);
    return Math.max(clampedPixels, contentFloorPx);
}

function orderDistinctInstants(instants: Instant[]): Instant[] {
    const byEpochMs = new Map<number, Instant>();
    for (const instant of instants) {
        byEpochMs.set(instant.getTime(), instant);
    }
    return [...byEpochMs.values()].sort((a, b) => a.getTime() - b.getTime());
}

// The gap LEAVING an instant pays for its rows; `extraGapPx` (task 300) is added on top of the winner.
function accumulateOffsets(
    ordered: Instant[],
    measureContentFloorPx: (instant: Instant) => number,
    eventCounts: Map<number, number>,
    extraGapPx: Map<number, number>,
): RulerPosition[] {
    let offsetPx = 0;
    let previous: Instant | undefined = undefined;
    return ordered.map((instant) => {
        offsetPx += previous === undefined ? 0 : measureGapPixels(previous, instant, measureContentFloorPx(previous))
            + (extraGapPx.get(previous.getTime()) ?? 0);
        previous = instant;
        // `?? 0` is unreachable — `ordered` is `eventCounts`' own key set; it only satisfies the possibly-undefined type of Map.get.
        return { instant, offsetPx, eventCount: eventCounts.get(instant.getTime()) ?? 0 };
    });
}

// Entry point for bare instants; every gap falls back on the 16 px heuristic. Layer 1 uses layOutNodeLadders instead.
export function resolveInstantOffsets(instants: Instant[]): RulerPosition[] {
    return accumulateOffsets(orderDistinctInstants(instants), () => 0, countNodesPerInstant(instants), new Map());
}

// Per-ladder MAX, not an overall tally: bubbles sit side by side, so only nodes inside the same bubble stack.
function countRowsPerInstant(ladders: NodeLadder[]): Map<number, number> {
    const rowsPerInstant = new Map<number, number>();
    for (const ladder of ladders) {
        for (const [epochMs, rows] of countNodesPerInstant(ladder)) {
            rowsPerInstant.set(epochMs, Math.max(rowsPerInstant.get(epochMs) ?? 1, rows));
        }
    }
    return rowsPerInstant;
}

// Takes a bare instant list rather than a ladder: answers one ladder's row demand and task 275's flattened event count.
function countNodesPerInstant(nodes: Instant[]): Map<number, number> {
    const perInstant = new Map<number, number>();
    for (const instant of nodes) {
        perInstant.set(instant.getTime(), (perInstant.get(instant.getTime()) ?? 0) + 1);
    }
    return perInstant;
}

// A commit and an mtime landing on the same second is routine; drawing both at one offset is reported overprinting.
function assignRowSlots(ladder: NodeLadder): number[] {
    const filledRows = new Map<number, number>();
    return ladder.map((instant) => {
        const slot = filledRows.get(instant.getTime()) ?? 0;
        filledRows.set(instant.getTime(), slot + 1);
        return slot;
    });
}

// Task 251: ruler spacing is measured from what bubbles must show, so their contents are never squashed together.
export function layOutNodeLadders(ladders: NodeLadder[], extraGapPx: Map<number, number> = new Map()): RulerLayout {
    const rowsPerInstant = countRowsPerInstant(ladders);
    const everyNode = ladders.flat();
    const ticks = accumulateOffsets(
        orderDistinctInstants(everyNode),
        (instant) => (rowsPerInstant.get(instant.getTime()) ?? 1) * RULER_NODE_ROW_PIXELS,
        countNodesPerInstant(everyNode),
        extraGapPx,
    );
    const tickOffsets = new Map(ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        ticks,
        // `?? 0` is unreachable — every ladder instant went into `ticks` above; it only satisfies Map.get's type.
        ladderOffsetsPx: ladders.map((ladder) => assignRowSlots(ladder).map((slot, node) =>
            (tickOffsets.get(ladder[node]!.getTime()) ?? 0) + slot * RULER_NODE_ROW_PIXELS)),
    };
}
