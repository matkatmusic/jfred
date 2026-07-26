// Content-measured, capped ruler axis (task 234, spec S18 "Ruler scale — capped linear" /
// "Ruler bounds"; the content measurement is task 251): the ruler's ordered set of DISTINCT
// instants — every commit instant plus every disk mtime — resolved once, globally, to pixel
// offsets. Position is linear in elapsed time at 2.5 px per hour, with any single gap between
// adjacent instants capped at 120 px so a months-long history still fits one screen.
//
// What a gap is FLOORED at is task 251's change. It used to be a flat 16 px heuristic, picked to
// clear the 15 px `.node` dot — which allotted every ruler entry the same room no matter how much
// the bubbles sitting at it had to show, and is why a bubble's file name, commit hash and "on disk"
// rows ended up crushed into two overprinted lines (specs/bug screenshots/"squashed bubble contents
// colliding.png"). `layOutNodeLadders` MEASURES instead: each bubble declares the instants it must
// draw, an instant that two of ONE bubble's nodes share needs two stacked rows there, and the gap
// leaving that instant is charged rows x RULER_NODE_ROW_PIXELS. Content only ever pushes entries
// further apart, and it outranks the cap rather than the reverse — a capped gap would clip back the
// very rows it was just charged for.
//
// Both clamps ACCUMULATE (offset i depends on every earlier gap), which is why this cannot be
// expressed in CSS the way S8's `--axis-ms` is — the page is handed finished offsets, and a node's
// offset already carries its row within its own instant, so the page still does no arithmetic.
// Bounds fall out of the same ordered set: the first entry is the start (a disk orphan predating
// the first commit legitimately moves the start earlier) and the last is the end.
//
// This module lives in webapp/ rather than src/ because BOTH the endpoint (src/viewer_api_layer1.ts)
// and the page (webapp/layer1-filter.ts, task 253) must lay instants out identically — a folder
// filter re-runs this layout over the SURVIVING instants client-side, and a second copy of the gap
// arithmetic would let the filtered ruler drift from the one the server shipped.

// `Instant` is `Date` (src/layered_types.ts). Re-declared rather than imported because
// tsconfig.webapp.json's rootDir is "webapp": a src/ import — even a type-only one — pulls a file
// outside that rootDir into the emitting program and tsc rejects it.
type Instant = Date;

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
// instant's position on the shared ruler. Since task 251 this heuristic governs only
// `resolveInstantOffsets`, i.e. the layered graph's axis (task 239): a measured ladder's smallest
// possible demand is one row of RULER_NODE_ROW_PIXELS, which is larger and always outranks it.
export const RULER_MIN_GAP_PIXELS = 16;

// Task 251: the vertical space ONE node row occupies. DERIVED from webapp/layer1.html, not chosen —
// `.node` is a 15 px dot inside a 2.5 px ring (20 px outer) and `.nlabel` is 10 px text in the
// inherited 1.5 line box (15 px), both centred on the row; 20 px is therefore the first value at
// which two stacked rows stop touching and 22 leaves a 2 px hairline between them. Same value as
// ROW_PX in plans/layer1-mockup.html, the user-signed-off reference render. Change a node's size,
// its ring or the label's font size and this number must be redone.
export const RULER_NODE_ROW_PIXELS = 22;

// One instant's resolved place on the ruler.
export interface RulerPosition {
    instant: Instant;
    offsetPx: number;
}

// One bubble's nodes on the axis: the instants a SINGLE widget must draw, in the order it draws
// them. A bucket row draws no node row of its own, so it joins as a one-instant ladder — it still
// bounds the ruler, but it asks for nothing extra.
export type NodeLadder = Instant[];

// Where a set of ladders lands: the shared ruler, plus every node's finished offset.
export interface RulerLayout {
    // Every distinct instant, ascending, at the offset of its FIRST row — the page's ruler ticks,
    // and the anchor a same-instant group indicator reads against (task 259).
    ticks: RulerPosition[];
    // One offset per node, parallel to the ladders handed in (same outer AND inner index), with the
    // node's row within its instant already added. Parallel rather than keyed by instant because a
    // ladder's two nodes CAN share an instant, and those are exactly the two that must differ.
    ladderOffsetsPx: number[][];
}

// How far one gap advances the ruler: linear in elapsed time, clamped into the heuristic band, then
// raised to whatever the earlier instant's stacked rows actually need (0 when nothing was measured).
function measureGapPixels(earlier: Instant, later: Instant, contentFloorPx: number): number {
    const elapsedHours = (later.getTime() - earlier.getTime()) / MILLISECONDS_PER_HOUR;
    const linearPixels = elapsedHours * RULER_PIXELS_PER_HOUR;
    const clampedPixels = Math.min(Math.max(linearPixels, RULER_MIN_GAP_PIXELS), RULER_GAP_CAP_PIXELS);
    return Math.max(clampedPixels, contentFloorPx);
}

// De-duplicate (the same moment is one position) and sort ascending.
function orderDistinctInstants(instants: Instant[]): Instant[] {
    const byEpochMs = new Map<number, Instant>();
    for (const instant of instants) {
        byEpochMs.set(instant.getTime(), instant);
    }
    return [...byEpochMs.values()].sort((a, b) => a.getTime() - b.getTime());
}

// Walk an ALREADY ordered, already de-duplicated set of instants, accumulating gaps from the
// earliest at 0. `measureContentFloorPx` is asked about the EARLIER instant of each gap: the rows
// stacked at an instant hang BELOW it, so they are paid for by the gap leaving it, not the one
// arriving at it.
function accumulateOffsets(ordered: Instant[], measureContentFloorPx: (instant: Instant) => number): RulerPosition[] {
    let offsetPx = 0;
    let previous: Instant | undefined = undefined;
    return ordered.map((instant) => {
        offsetPx += previous === undefined ? 0 : measureGapPixels(previous, instant, measureContentFloorPx(previous));
        previous = instant;
        return { instant, offsetPx };
    });
}

// Resolve the ruler's instants to accumulated pixel offsets, earliest at 0. NO content measurement:
// bare instants say nothing about what is drawn at them, so every gap falls back on the 16 px
// heuristic. This is the layered graph's entry point (src/viewer_api_layered.ts, task 239); Layer 1
// calls layOutNodeLadders below instead.
export function resolveInstantOffsets(instants: Instant[]): RulerPosition[] {
    return accumulateOffsets(orderDistinctInstants(instants), () => 0);
}

// How many stacked rows each instant must make room for: the most nodes any ONE ladder places
// there. Per-ladder, not overall — two BUBBLES drawing a node at the same instant is the normal
// case and costs nothing, because bubbles sit side by side; only two nodes inside the SAME bubble
// have to stack, and the tallest such stack is what the ruler owes.
function countRowsPerInstant(ladders: NodeLadder[]): Map<number, number> {
    const rowsPerInstant = new Map<number, number>();
    for (const ladder of ladders) {
        for (const [epochMs, rows] of countLadderNodesPerInstant(ladder)) {
            rowsPerInstant.set(epochMs, Math.max(rowsPerInstant.get(epochMs) ?? 1, rows));
        }
    }
    return rowsPerInstant;
}

// One ladder's nodes tallied by instant — also the source of each node's row, since the Nth node a
// bubble draws at one instant belongs on row N.
function countLadderNodesPerInstant(ladder: NodeLadder): Map<number, number> {
    const perInstant = new Map<number, number>();
    for (const instant of ladder) {
        perInstant.set(instant.getTime(), (perInstant.get(instant.getTime()) ?? 0) + 1);
    }
    return perInstant;
}

// Each node's row within its own instant, parallel to the ladder: 0 for the first node a bubble
// draws at a moment, 1 for the next, and so on. A commit and an mtime landing on the same second is
// routine, and drawing both at one offset is the overprinting the bug screenshots show.
function assignRowSlots(ladder: NodeLadder): number[] {
    const filledRows = new Map<number, number>();
    return ladder.map((instant) => {
        const slot = filledRows.get(instant.getTime()) ?? 0;
        filledRows.set(instant.getTime(), slot + 1);
        return slot;
    });
}

// Lay every bubble's nodes onto one shared ruler whose spacing is measured from what those bubbles
// must show (task 251). The ladders are the ONLY input: their instants are the ruler, their
// per-instant node counts are its floors, and their nodes come back placed.
export function layOutNodeLadders(ladders: NodeLadder[]): RulerLayout {
    const rowsPerInstant = countRowsPerInstant(ladders);
    const ticks = accumulateOffsets(
        orderDistinctInstants(ladders.flat()),
        (instant) => (rowsPerInstant.get(instant.getTime()) ?? 1) * RULER_NODE_ROW_PIXELS,
    );
    const tickOffsets = new Map(ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        ticks,
        // Every ladder instant went into `ticks` a few lines above, so `?? 0` is unreachable rather
        // than a silent fallback — it exists only because Map.get is typed as possibly-undefined.
        ladderOffsetsPx: ladders.map((ladder) => assignRowSlots(ladder).map((slot, node) =>
            (tickOffsets.get(ladder[node]!.getTime()) ?? 0) + slot * RULER_NODE_ROW_PIXELS)),
    };
}
