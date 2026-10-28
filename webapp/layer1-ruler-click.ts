// Task 260: the lookup runs entirely off `--axis-px`, so it cannot drift from what was drawn.

// A `.tick` and `.filebox` carry ABSOLUTE offsets; a `.node` or bucket `li` is WIDGET-RELATIVE.

// What is scrolled and lit is ALWAYS the ROW at the clicked instant, never the bubble's box.

// ponytail: native `scrollIntoView` reads LIVE layout, so it survives the CSS `zoom` on `.canvas`.

import { getRequiredElementById } from "./app-dom.ts";
import { markLandedElement, moveToUncoveredCentre } from "./layer1-find-file.ts";
// A cycle, but safe: both modules only DECLARE functions at load, so neither runs before the other is populated.
import { listEventsAtRow, storeRow } from "./layer1-tick-events.ts";
import { toggleExpandedRow } from "./layer1-tick-files.ts";
import type { RulerRow } from "./layer1-ruler-rows.ts";

// Not a fuzzy-match window: a float rounding step, far below the 1 px that would pull in another instant.
const AXIS_MATCH_EPSILON_PX = 1e-6;

// The caller supplies the frame of reference — absolute or widget-relative — this only reads it back.
export function readAxisPx(element: HTMLElement): number {
  return Number(element.style.getPropertyValue("--axis-px"));
}

// Task 251: same-instant nodes stack a row apart; each answers at its instant's first row, where the tick sits.
export function readTickAxisPx(row: HTMLElement, bubbleRows: readonly HTMLElement[]): number {
  const instant = row.dataset.instant;
  if (instant === undefined) {
    return readAxisPx(row);
  }
  const sameInstantPxList: number[] = [];
  for (const other of bubbleRows) {
    const isSameInstant = other.dataset.instant === instant;
    if (isSameInstant) {
      sameInstantPxList.push(readAxisPx(other));
    }
  }
  return Math.min(...sameInstantPxList);
}

// Shared with layer1-leader-visibility.ts so a leader line and a tick can never disagree about what sits at an instant.
export function isAxisMatch(candidatePx: number, targetPx: number): boolean {
  return Math.abs(candidatePx - targetPx) <= AXIS_MATCH_EPSILON_PX;
}

// Buckets count as bubbles: one is placed at its earliest member's instant, so it also "begins".
function listBubbles(): HTMLElement[] {
  return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".filebox")];
}

// `li` is here because a bucket renders a plain list and no `.node` (task 266).
const BUBBLE_ROW_SELECTOR = ".node, li";

// One bubble's drawn rows with their offsets read once, so repeated lookups skip the DOM walk.
export interface BubbleSnapshot {
  bubble: HTMLElement;
  bubblePx: number;
  rows: { row: HTMLElement; rowPx: number }[];
}

// Task 309: per-ruler-row stage walks cost ~1.3 s over 900 bubbles; a shared snapshot pays once.
export function collectStageBubbles(): BubbleSnapshot[] {
  const snapshot: BubbleSnapshot[] = [];
  for (const bubble of listBubbles()) {
    const rows = [...bubble.querySelectorAll<HTMLElement>(BUBBLE_ROW_SELECTOR)];
    const rowEntries: BubbleSnapshot["rows"] = [];
    for (const row of rows) {
      rowEntries.push({ row, rowPx: readTickAxisPx(row, rows) });
    }
    snapshot.push({ bubble, bubblePx: readAxisPx(bubble), rows: rowEntries });
  }
  return snapshot;
}

// Rows of a bubble that BEGINS at the instant sort before rows of bubbles merely holding it.
export function listElementsDrawnAtAxisPx(axisPx: number, snapshot: BubbleSnapshot[] = collectStageBubbles()): HTMLElement[] {
  const beginningHere: HTMLElement[] = [];
  const merelyHolding: HTMLElement[] = [];
  for (const { bubble, bubblePx, rows } of snapshot) {
    const matching: HTMLElement[] = [];
    for (const { row, rowPx } of rows) {
      const isDrawnAtAxisPx = isAxisMatch(bubblePx + rowPx, axisPx);
      if (isDrawnAtAxisPx) {
        matching.push(row);
      }
    }
    const bubbleBeginsHere = isAxisMatch(bubblePx, axisPx);
    if (!bubbleBeginsHere) {
      merelyHolding.push(...matching);
      continue;
    }
    beginningHere.push(...(matching.length > 0 ? matching : [bubble]));
  }
  return [...beginningHere, ...merelyHolding];
}

// User's rule: of the bubbles sharing an instant the one that BEGINS there wins, answering with its ROW.
export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
  // Task 360: the jump skips hidden kinds, else it scrolls to a node nobody can see.
  // return listElementsDrawnAtAxisPx(axisPx)[0];
  return listEventsAtRow([axisPx])[0]?.element;
}

// `row` carries every entry the tick absorbed, because a merged row stands for several instants.
export function attachRulerTickClick(tick: HTMLElement, row: RulerRow): HTMLElement {
  storeRow(tick, row);
  function triggerTickAction(): void {
    // Task 284: several things are drawn here, so expand into their names rather than jumping blindly.
    const events = listEventsAtRow(row.axisPxList);
    if (events.length > 1) {
      toggleExpandedRow(tick, events);
      return;
    }
    // Centred in the part of #timelines the Details drawer leaves uncovered.
    const landed = findScrollTargetForAxisPx(readAxisPx(tick));
    if (landed === undefined) {
      return;
    }
    moveToUncoveredCentre(landed);
    markLandedElement(landed);
  }
  tick.addEventListener("click", triggerTickAction);
  return tick;
}
