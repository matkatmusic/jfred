// Task 260: the lookup runs entirely off `--axis-px`, so it cannot drift from what was drawn.

// A `.tick` and `.filebox` carry ABSOLUTE offsets; a `.node` or bucket `li` is WIDGET-RELATIVE.

// What is scrolled and lit is ALWAYS the ROW at the clicked instant, never the bubble's box.

// ponytail: native `scrollIntoView` reads LIVE layout, so it survives the CSS `zoom` on `.canvas`.

import { getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
// A cycle, but safe: both modules only DECLARE functions at load, so neither runs before the other is populated.
import { listEventsAtRow, rememberRowOffsets, toggleExpandedRow } from "./layer1-tick-files.ts";

// Not a fuzzy-match window: a float rounding step, far below the 1 px that would pull in another instant.
const AXIS_MATCH_EPSILON_PX = 1e-6;

// The caller supplies the frame of reference — absolute or widget-relative — this only reads it back.
export function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

// Shared with layer1-leader-visibility.ts so a leader line and a tick can never disagree about what sits at an instant.
export function axisMatches(candidatePx: number, targetPx: number): boolean {
    return Math.abs(candidatePx - targetPx) <= AXIS_MATCH_EPSILON_PX;
}

// Buckets count as bubbles: one is placed at its earliest member's instant, so it also "begins".
function listBubbles(): HTMLElement[] {
    return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".filebox")];
}

// `li` is here because a bucket renders a plain list and no `.node` (task 266).
const BUBBLE_ROW_SELECTOR = ".node, li";

// Rows of a bubble that BEGINS at the instant sort before rows of bubbles merely holding it.
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

// User's rule: of the bubbles sharing an instant the one that BEGINS there wins, answering with its ROW.
export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
    return listElementsDrawnAtAxisPx(axisPx)[0];
}

// `axisPxList` is every entry the row absorbed, because a merged row stands for several instants.
export function makeRulerTickClickable(tick: HTMLElement, axisPxList: number[]): HTMLElement {
    rememberRowOffsets(tick, axisPxList);
    tick.addEventListener("click", () => {
        // Task 284: several things are drawn here, so expand into their names rather than jumping blindly.
        const events = listEventsAtRow(axisPxList);
        if (events.length > 1) {
            toggleExpandedRow(tick, events);
            return;
        }
        // `block: "nearest"`, not "start": the clicked row is already on screen. `inline: "center"` does the work.
        const landed = findScrollTargetForAxisPx(readAxisPx(tick));
        if (landed === undefined) {
            return;
        }
        landed.scrollIntoView({ block: "nearest", inline: "center" });
        highlightLandedElement(landed);
    });
    return tick;
}
