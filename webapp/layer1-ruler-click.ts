// Task 260: clicking a ruler tick navigates to the instant it names. The lookup runs entirely off
// `--axis-px` so it cannot drift from what was drawn: a `.tick` and a `.filebox` carry ABSOLUTE
// offsets (a bubble's being its earliest node's), while a `.node` or bucket `li` is WIDGET-RELATIVE.
//
// What is scrolled and lit is ALWAYS the ROW at the clicked instant, never the bubble's box (user,
// 2026-07-26): a bubble's top is its FIRST instant, so targeting the box put the clicked timestamp
// off-screen whenever it sat further down the ladder.
//
// ponytail: no scrolling helper and no measurement. Native `scrollIntoView` reads LIVE layout, so it
// stays correct under a shrunken scrollport and the CSS `zoom` on `.canvas`; reimplementing it from
// offsetTop/scrollTop is exactly the unzoomed-vs-zoomed units bug the earlier zoom work hit.

import { getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
// A cycle: that module reads the stage through listElementsDrawnAtAxisPx below. Both modules only
// DECLARE functions at load, so neither runs before the other is populated.
import { listEventsAtRow, rememberRowOffsets, toggleExpandedRow } from "./layer1-tick-files.ts";

// Not a fuzzy-match window: recovering `startPx + (nodePx - startPx)` is exact only to a float
// rounding step, and this stays far below the 1 px that would pull in a different instant.
const AXIS_MATCH_EPSILON_PX = 1e-6;

// The caller supplies the frame of reference — absolute or widget-relative — this only reads it back.
export function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

// Shared with layer1-leader-visibility.ts so a leader line and a tick can never disagree about
// what sits at an instant.
export function axisMatches(candidatePx: number, targetPx: number): boolean {
    return Math.abs(candidatePx - targetPx) <= AXIS_MATCH_EPSILON_PX;
}

// Buckets count as bubbles: one is placed at its earliest member's instant, so it also "begins".
function listBubbles(): HTMLElement[] {
    return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".filebox")];
}

// `li` is here because a bucket renders a plain list and no `.node` (task 266), so an instant only
// a bucket held used to answer a click with nothing at all.
const BUBBLE_ROW_SELECTOR = ".node, li";

// Rows of a bubble that BEGINS at the instant sort before rows of bubbles that merely hold it. The
// box itself is a safety net: a beginning bubble with no matching row would otherwise answer a click
// with a silent no-op, indistinguishable from the feature being broken. Both the tick click and the
// leader hover read this one walk, so they cannot disagree about what is at an instant.
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

// The user's rule (settled 2026-07-25, amended 2026-07-26): of the bubbles sharing an instant the
// one that BEGINS there wins, and the answer is always its ROW. Measured over this repo, 305 of 683
// ruler rows sit below the top of the bubble that answers them, a median 1,870 px.
export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
    return listElementsDrawnAtAxisPx(axisPx)[0];
}

// The instant is read off the element rather than passed alongside it, since a second parameter
// could disagree with what `setAxisPx` already wrote. `axisPxList` is every entry the row absorbed
// (layer1-ruler-rows.ts), because a merged row stands for several instants.
export function makeRulerTickClickable(tick: HTMLElement, axisPxList: number[]): HTMLElement {
    rememberRowOffsets(tick, axisPxList);
    tick.addEventListener("click", () => {
        // Task 284: several things are drawn here, so expand into their names rather than silently
        // jumping to whichever the lookup found first.
        const events = listEventsAtRow(axisPxList);
        if (events.length > 1) {
            toggleExpandedRow(tick, events);
            return;
        }
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
