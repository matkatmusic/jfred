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
//   * a `.node` inside a bubble — and, since task 266, a bucket's `li` — carries a WIDGET-RELATIVE
//     offset, so its absolute position is its bubble's offset plus its own.
//
// What is SCROLLED is the element that matched, not always its bubble. `block: "start"` aligns the
// target's own top with the pane, and a bubble's top is its FIRST instant; handing it the bubble
// whenever the clicked instant sits further down the ladder is task 266 (see findRowHoldingAxisPx).
//
// ponytail: no scrolling helper and no measurement. Native `scrollIntoView` —
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

// Everything inside a bubble that carries a WIDGET-RELATIVE `--axis-px`: a pair's node dots, and an
// orphan bucket's list items (task 266 — a bucket renders a plain list and no `.node`, so an instant
// only a bucket held used to answer a click with nothing at all).
const BUBBLE_ROW_SELECTOR = ".node, li";

// Stage 2, the user's fallback: "if no bubble starts there, scroll to the node at that timestamp".
// Returns the ROW ITSELF rather than its bubble, which is task 266's fix. `block: "start"` aligns
// whatever it is given with the top of the pane, and a bubble's own top is its FIRST instant, not
// the clicked one — measured over this repo, 305 of 683 ruler rows resolve through this stage and
// the bubble they land on begins a median 1,870 px (up to 15,205 px) above the row that was
// clicked, so for 212 of them the clicked timestamp ended up off-screen entirely. Row offsets are
// relative to their own bubble, hence the addition.
function findRowHoldingAxisPx(bubbles: HTMLElement[], axisPx: number): HTMLElement | undefined {
    for (const bubble of bubbles) {
        const bubblePx = readAxisPx(bubble);
        const held = [...bubble.querySelectorAll<HTMLElement>(BUBBLE_ROW_SELECTOR)]
            .find((row) => axisMatches(bubblePx + readAxisPx(row), axisPx));
        if (held !== undefined) {
            return held;
        }
    }
    return undefined;
}

// The two stages in order. Exported for the test, which asserts each stage independently — the
// fallback only ever fires on data where stage 1 misses, so it is unreachable through the happy path.
export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
    const bubbles = listBubbles();
    return findBubbleBeginningAt(bubbles, axisPx) ?? findRowHoldingAxisPx(bubbles, axisPx);
}

// Turn one already-positioned tick into the navigation control, and hand it back so the caller can
// keep building its list in a single expression. The instant is read off the element rather than
// passed alongside it: `setAxisPx` has already put it there, and a second parameter could disagree.
// A tick with no bubble at all (possible only if the stage is empty) is left inert rather than
// throwing — `.ruler .tick:hover` still lights up, which is the same affordance every other tick has.
export function makeRulerTickClickable(tick: HTMLElement): HTMLElement {
    tick.addEventListener("click", () => {
        // `block: "nearest"` — deliberately NOT layer1-find-file.ts's `block: "start"`, and this is
        // the second half of task 266. The find box aims at a bubble the reader cannot see yet, so
        // it has to choose a vertical resting place. A ruler tick is the opposite case: the row
        // being clicked is BY DEFINITION already on screen, and any forced vertical alignment drags
        // it somewhere else — to the pane's top edge at best, and clean out of the viewport when
        // the target's own top is an earlier instant. "nearest" scrolls vertically only if the
        // target is not already visible, so the clicked row stays exactly where the reader left it.
        // `inline: "center"` does the actual work: the stage is ~168,000 px wide, so bringing the
        // bubble across horizontally IS the jump.
        findScrollTargetForAxisPx(readAxisPx(tick))?.scrollIntoView({ block: "nearest", inline: "center" });
    });
    return tick;
}
