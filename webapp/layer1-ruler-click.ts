// Task 260: the Layer 1 ruler as a NAVIGATION control. A tick in the sticky left gutter used to be
// inert text; clicking one now centers the bubble that instant belongs to in the visible timeline
// area. Split out of layer1-page.ts because that file is at the 250-line cap — the only thing it
// gains is one call inside renderRulerTicks.
//
// The lookup runs entirely off `--axis-px`, the ONE value the page contributes to layout, so this
// module needs no second copy of the wire data and cannot drift out of sync with what was drawn:
//   * a `.tick` carries the ABSOLUTE ruler offset of its instant;
//   * a `.filebox` carries the absolute offset of its EARLIEST node (layer1-page.ts's `startPx`),
//     which is precisely "the instant this bubble begins at";
//   * a `.node` inside a bubble carries a WIDGET-RELATIVE offset, so its absolute position is its
//     bubble's offset plus its own.
//
// ponytail: no scrolling helper and no measurement. Native `scrollIntoView({ block: "center" })` —
// used in ~12 other places here — reads the LIVE layout at click time, so it is automatically
// correct after a pane (task 257's Detail View drawer, task 258's inspector) has shrunk the
// scrollport, and under the native CSS `zoom` layer1-zoom.ts puts on `.canvas`. Reimplementing it
// from offsetTop/scrollTop is exactly the unzoomed-vs-zoomed units bug the earlier zoom work hit.

import { getRequiredElementById } from "./app-dom.ts";

// Tolerance for matching one `--axis-px` against another, in px. Not a fuzzy-match window: a node's
// absolute offset is recovered as `startPx + (nodePx - startPx)`, which is only exact to within a
// float rounding step, so this absorbs that and nothing else. Deliberately far below the 1 px that
// would start pulling in a genuinely different instant.
const AXIS_MATCH_EPSILON_PX = 1e-6;

// The offset an element was drawn at. Absolute for `.tick` and `.filebox`, widget-relative for
// `.node` — the caller supplies the frame of reference, this only reads the number back out.
function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

function axisMatches(candidatePx: number, targetPx: number): boolean {
    return Math.abs(candidatePx - targetPx) <= AXIS_MATCH_EPSILON_PX;
}

// Every bubble on the stage, in document order: the pair widgets and the two orphan buckets alike,
// since a bucket is placed at its earliest member's instant and so also "begins" somewhere.
function listBubbles(): HTMLElement[] {
    return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".filebox")];
}

// Stage 1 of the user's rule (settled 2026-07-25): of the bubbles sharing an instant, the one that
// BEGINS there wins. A bubble's own `--axis-px` IS its first node's offset, so this is a direct
// comparison and no walk into the lane is needed.
function findBubbleBeginningAt(bubbles: HTMLElement[], axisPx: number): HTMLElement | undefined {
    return bubbles.find((bubble) => axisMatches(readAxisPx(bubble), axisPx));
}

// Stage 2, the user's fallback: "if no bubble starts there, scroll to the node at that timestamp" —
// find any node drawn on the instant and center the bubble CONTAINING it. Node offsets are relative
// to their own bubble, hence the addition.
function findBubbleHoldingNodeAt(bubbles: HTMLElement[], axisPx: number): HTMLElement | undefined {
    return bubbles.find((bubble) => {
        const bubblePx = readAxisPx(bubble);
        return [...bubble.querySelectorAll<HTMLElement>(".node")]
            .some((node) => axisMatches(bubblePx + readAxisPx(node), axisPx));
    });
}

// The two stages in order. Exported for the test, which asserts each stage independently — the
// fallback only ever fires on data where stage 1 misses, so it is unreachable through the happy path.
export function findBubbleForAxisPx(axisPx: number): HTMLElement | undefined {
    const bubbles = listBubbles();
    return findBubbleBeginningAt(bubbles, axisPx) ?? findBubbleHoldingNodeAt(bubbles, axisPx);
}

// Turn one already-positioned tick into the navigation control, and hand it back so the caller can
// keep building its list in a single expression. The instant is read off the element rather than
// passed alongside it: `setAxisPx` has already put it there, and a second parameter could disagree.
// A tick with no bubble at all (possible only if the stage is empty) is left inert rather than
// throwing — `.ruler .tick:hover` still lights up, which is the same affordance every other tick has.
export function makeRulerTickClickable(tick: HTMLElement): HTMLElement {
    tick.addEventListener("click", () => {
        findBubbleForAxisPx(readAxisPx(tick))?.scrollIntoView({ block: "center", inline: "center" });
    });
    return tick;
}
