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
// What is SCROLLED, and what is LIT (tasks 283/267 — the same element, so no second lookup is
// needed), is ALWAYS the ROW drawn at the clicked instant: the `.node`, or a bucket's `li`. Never the
// bubble's box. The user, 2026-07-26: "clicking on a timeline ruler row does not always select a
// node, sometimes it selects a bubble instead of the node... if the node is the first node in the
// bubble and the timestamp for that node was clicked then the bubble is what gets selected, otherwise
// any node in the bubble that is not the first node in the bubble gets selected correctly". One click
// read as two different behaviours depending on where in the ladder the instant fell, and they could
// not tell what a highlighted BUBBLE was even saying. The "bubble that BEGINS here wins" rule stays,
// but it now decides WHICH BUBBLE's row is the answer, not that the box itself is the target.
//
// Task 266's reasoning is unchanged and is the other half of why: `block: "start"` aligns the
// target's own top with the pane, and a bubble's top is its FIRST instant, so handing over the bubble
// whenever the clicked instant sits further down the ladder scrolls the wrong row into view.
//
// ponytail: no scrolling helper and no measurement. Native `scrollIntoView` —
// used in ~12 other places here — reads the LIVE layout at click time, so it is automatically
// correct after a pane (task 257's Detail View drawer, task 258's inspector) has shrunk the
// scrollport, and under the native CSS `zoom` layer1-zoom.ts puts on `.canvas`. Reimplementing it
// from offsetTop/scrollTop is exactly the unzoomed-vs-zoomed units bug the earlier zoom work hit.

import { getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";

// Tolerance for matching one `--axis-px` against another, in px. Not a fuzzy-match window: a node's
// absolute offset is recovered as `startPx + (nodePx - startPx)`, which is only exact to within a
// float rounding step, so this absorbs that and nothing else. Deliberately far below the 1 px that
// would start pulling in a genuinely different instant.
const AXIS_MATCH_EPSILON_PX = 1e-6;

// The offset an element was drawn at. Absolute for `.tick`, `.filebox` and `.leader`, widget-relative
// for `.node` — the caller supplies the frame of reference, this only reads the number back out.
// Exported for layer1-leader-hover.ts, which reads a leader line's own offset with it.
export function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

// Exported for layer1-leader-visibility.ts, which matches a hovered element's absolute offset
// against the offsets the leader lines were drawn at — the same comparison against the same
// tolerance, so a line and a tick can never disagree about what sits at an instant.
export function axisMatches(candidatePx: number, targetPx: number): boolean {
    return Math.abs(candidatePx - targetPx) <= AXIS_MATCH_EPSILON_PX;
}

// Every bubble on the stage, in document order: the pair widgets and the two orphan buckets alike,
// since a bucket is placed at its earliest member's instant and so also "begins" somewhere.
function listBubbles(): HTMLElement[] {
    return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".filebox")];
}

// Everything inside a bubble that carries a WIDGET-RELATIVE `--axis-px`: a pair's node dots, and an
// orphan bucket's list items (task 266 — a bucket renders a plain list and no `.node`, so an instant
// only a bucket held used to answer a click with nothing at all).
const BUBBLE_ROW_SELECTOR = ".node, li";

// Every ROW drawn at one instant, ordered so the rows of a bubble that BEGINS there come before the
// rows of bubbles that merely hold it, document order within each group. A bubble that neither begins
// there nor drew a matching row contributes nothing. The box itself is contributed ONLY as a safety
// net: a bubble that begins at the instant but drew no matching row would otherwise answer a click
// with nothing, and a silent no-op is indistinguishable from the feature being broken.
//
// Both the tick click and the leader hover read this one walk, so they cannot disagree about what is
// at an instant. A bubble's own `--axis-px` IS its first node's offset, so "begins here" is a direct
// comparison; row offsets are relative to their own bubble, hence the addition.
export function listElementsDrawnAtAxisPx(axisPx: number): HTMLElement[] {
    const beginningHere: HTMLElement[] = [];
    const merelyHolding: HTMLElement[] = [];
    for (const bubble of listBubbles()) {
        const bubblePx = readAxisPx(bubble);
        const rows = [...bubble.querySelectorAll<HTMLElement>(BUBBLE_ROW_SELECTOR)]
            .filter((row) => axisMatches(bubblePx + readAxisPx(row), axisPx));
        if (!axisMatches(bubblePx, axisPx)) {
            merelyHolding.push(...rows);
            continue;
        }
        beginningHere.push(...(rows.length > 0 ? rows : [bubble]));
    }
    return [...beginningHere, ...merelyHolding];
}

// The user's rule (settled 2026-07-25, amended 2026-07-26) read straight off that order: of the
// bubbles sharing an instant the one that BEGINS there wins, else "scroll to the node at that
// timestamp" — and either way it is the ROW, never the bubble, which is task 266's fix plus the
// bubble-selection bug above. `block: "start"` aligns whatever it is given with the top of the pane,
// and a bubble's own top is its FIRST instant, not the clicked one — measured over this repo, 305 of
// 683 ruler rows sit below the top of the bubble that answers them, a median 1,870 px (up to
// 15,205 px), so for 212 of them a bubble-shaped target put the clicked timestamp off-screen
// entirely. Exported for the test, which asserts each case independently.
export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
    return listElementsDrawnAtAxisPx(axisPx)[0];
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
        const landed = findScrollTargetForAxisPx(readAxisPx(tick));
        if (landed === undefined) {
            return;
        }
        landed.scrollIntoView({ block: "nearest", inline: "center" });
        highlightLandedElement(landed);
    });
    return tick;
}
