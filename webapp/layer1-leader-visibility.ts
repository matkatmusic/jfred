// The dashed leader lines draw on demand: no lines at rest, and this module picks the single line shown.

import { getRequiredElementById } from "./app-dom.ts";
import { LANDED_EVENT } from "./layer1-find-file.ts";
import { isAxisMatch, readAxisPx, readTickAxisPx } from "./layer1-ruler-click.ts";

// The class layer1-styles.css paints the line from; not `.aimed`, which is the hover-the-line state.
const SHOWN_CLASS = "shown";

// Everything in a bubble with a widget-relative `--axis-px`: node dots, their labels, and bucket list items.
const BUBBLE_ROW_SELECTOR = ".node, .nlabel, li";

// Two slots so a hover cannot wipe the selection's line, and moving off needs no manual restore.
let hoveredLeader: HTMLElement | undefined;
let selectedLeader: HTMLElement | undefined;

function listLeaderLines(): HTMLElement[] {
  return [...getRequiredElementById("leaders").querySelectorAll<HTMLElement>(".leader")];
}

// Redraw from the two slots; a stale slot from a previous render matches nothing, so no reset is needed.
function renderShownLeaders(): void {
  for (const leader of listLeaderLines()) {
    leader.classList.toggle(SHOWN_CLASS, leader === hoveredLeader || leader === selectedLeader);
  }
}

// The absolute ruler offset an element sits at, or undefined for page furniture; nodes add their bubble's base back.
function readAbsoluteAxisPx(element: HTMLElement): number | undefined {
  const tick = element.closest<HTMLElement>(".tick");
  if (tick !== null) {
    return readAxisPx(tick);
  }
  const bubble = element.closest<HTMLElement>(".filebox");
  if (bubble === null) {
    return undefined;
  }
  const row = element.closest<HTMLElement>(BUBBLE_ROW_SELECTOR);
  // return readAxisPx(bubble) + (row === null ? 0 : readAxisPx(row));
  const bubbleRows = [...bubble.querySelectorAll<HTMLElement>(BUBBLE_ROW_SELECTOR)];
  return readAxisPx(bubble) + (row === null ? 0 : readTickAxisPx(row, bubbleRows));
}

// The one leader line for `element`, or undefined when it sits on nothing or its line was never drawn.
function findLeaderFor(element: HTMLElement | undefined): HTMLElement | undefined {
  const axisPx = element === undefined ? undefined : readAbsoluteAxisPx(element);
  if (axisPx === undefined) {
    return undefined;
  }
  for (const leader of listLeaderLines()) {
    const isAtAxisPx = isAxisMatch(readAxisPx(leader), axisPx);
    if (isAtAxisPx) {
      return leader;
    }
  }
  return undefined;
}

// Exported for the test, which drives which element maps to which line without synthetic pointer events.
export function showLeaderForHoveredElement(element: HTMLElement | undefined): void {
  hoveredLeader = findLeaderFor(element);
  renderShownLeaders();
}

export function wireLeaderVisibility(): void {
  const pane = getRequiredElementById("timelines");
  function updateLeaderOnPointerOver(event: PointerEvent): void {
    showLeaderForHoveredElement(event.target as HTMLElement);
  }
  function updateLeaderOnPointerLeave(): void {
    showLeaderForHoveredElement(undefined);
  }
  function updateSelectedLeaderOnLanding(event: Event): void {
    selectedLeader = findLeaderFor((event as CustomEvent<HTMLElement>).detail);
    renderShownLeaders();
  }
  // `pointerover` fires again for each descendant; `pointerleave` on the pane is the only off-signal needed.
  pane.addEventListener("pointerover", updateLeaderOnPointerOver);
  pane.addEventListener("pointerleave", updateLeaderOnPointerLeave);
  // A landing is the selection: its line outlives the pointer until the next landing replaces it.
  document.addEventListener(LANDED_EVENT, updateSelectedLeaderOnLanding);
}
