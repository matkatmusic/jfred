// Layer 1's jump-to-bubble box; native scrollIntoView is used because offsetTop is unscaled when zoomed.

import { getRequiredElementById } from "../../app-dom.ts";
import { addSlackForEdgeNode } from "./layer1-find-slack.ts";
import { findMatchingBubbles, listNameElements, reportFindStatus, resetFindCycle, selectMatchAtStep } from "./layer1-find-match.ts";

// A list because a landing lights the row and its owning bubble.
let litElements: HTMLElement[] = [];

// Fired on `document` when a jump lands; layer1-leader-visibility.ts keeps that element's dashed leader line up.
export const LANDED_EVENT = "layer1-landed";

// Only one thing carries `.found` at a time, and it stays lit (user, 2026-07-26).
export function markLandedElement(landed: HTMLElement): void {
  for (const lit of litElements) {
    lit.classList.remove("found");
  }
  // The owning bubble is lit too, never instead (user, 2026-07-27); skipped when `closest` returns the element itself.
  const owningBubble = landed.closest<HTMLElement>(".filebox");
  litElements = [landed];
  const hasSeparateOwner = owningBubble !== null && owningBubble !== landed;
  if (hasSeparateOwner) {
    litElements.push(owningBubble);
  }
  for (const lit of litElements) {
    lit.classList.add("found");
  }
  // A DOM event avoids an import cycle; `window.CustomEvent` because happy-dom rejects other classes.
  document.dispatchEvent(new window.CustomEvent(LANDED_EVENT, { detail: landed }));
}

function computeUncoveredArea(view: DOMRect, drawer: DOMRect): { left: number; right: number; top: number; bottom: number } {
  const area = { left: view.left, right: view.right, top: view.top, bottom: view.bottom };
  const isCovered = Math.min(view.right, drawer.right) > Math.max(view.left, drawer.left)
        && Math.min(view.bottom, drawer.bottom) > Math.max(view.top, drawer.top);
  if (!isCovered) {
    return area;
  }
  const coversFullHeight = drawer.top <= view.top && drawer.bottom >= view.bottom;
  if (coversFullHeight) {
    return drawer.left > view.left ? { ...area, right: drawer.left } : { ...area, left: drawer.right };
  }
  return drawer.top > view.top ? { ...area, bottom: drawer.top } : { ...area, top: drawer.bottom };
}

// Centres the element in the part of #timelines the Details drawer leaves uncovered.
export function moveToUncoveredCentre(element: HTMLElement): void {
  const pane = getRequiredElementById("timelines");
  const area = computeUncoveredArea(pane.getBoundingClientRect(), getRequiredElementById("drawer").getBoundingClientRect());
  let box = element.getBoundingClientRect();
  const hasAddedSlack = addSlackForEdgeNode(pane, box, area);
  if (hasAddedSlack) {
    box = element.getBoundingClientRect();
  }
  pane.scrollLeft += (box.left + box.right) / 2 - (area.left + area.right) / 2;
  pane.scrollTop += (box.top + box.bottom) / 2 - (area.top + area.bottom) / 2;
}

// Shared by the typed box and File Nav click; `block: "start"` avoids centring above the viewport.
function moveToBubble(bubble: HTMLElement): void {
  bubble.scrollIntoView({ block: "start", inline: "center" });
  markLandedElement(bubble);
}

// Jump to the next (or, with step -1, the previous) bubble named by `term`.
export function moveToNamedBubble(term: string, step: number = 1): HTMLElement | undefined {
  const trimmed = term.trim();
  if (trimmed === "") {
    return undefined;
  }
  const landed = selectMatchAtStep(trimmed, step);
  if (landed !== undefined) {
    moveToBubble(landed);
  }
  return landed;
}

function findNameElementAtPath(path: string): HTMLElement | undefined {
  for (const nameElement of listNameElements()) {
    const isOwner = nameElement.dataset.path === path;
    if (isOwner) {
      return nameElement;
    }
  }
  return undefined;
}

// The File Nav's caller: a leaf knows its exact path, so it needs no substring match or cycle.
export function moveToBubbleAtPath(path: string): HTMLElement | undefined {
  const owner = findNameElementAtPath(path);
  if (owner === undefined) {
    // An orphan path has no bubble, so the click must say so, not look broken.
    reportFindStatus(`${path}: no bubble on the timeline (listed in an orphan bucket)`);
    return undefined;
  }
  const landed = owner.closest(".filebox") as HTMLElement;
  moveToBubble(landed);
  return landed;
}

// All three pieces of a live search drop together so nothing lingers.
function clearFindState(): void {
  for (const lit of litElements) {
    lit.classList.remove("found");
  }
  litElements = [];
  resetFindCycle();
  reportFindStatus("");
}

// Module scope like the cycle: -1 means no row is selected, so Enter searches the typed text.
let selectedSuggestionIndex = -1;

function listSuggestionRows(): HTMLElement[] {
  return [...getRequiredElementById("find-file-results").children] as HTMLElement[];
}

function markSelectedSuggestion(index: number): void {
  selectedSuggestionIndex = index;
  const rows = listSuggestionRows();
  for (const [rowIndex, row] of rows.entries()) {
    row.classList.toggle("selected", rowIndex === index);
  }
}

// The picked path goes into the box, then the existing find runs on it as if it had been typed.
function pickSuggestion(box: HTMLInputElement, path: string): void {
  box.value = path;
  getRequiredElementById("find-file-results").replaceChildren();
  selectedSuggestionIndex = -1;
  moveToNamedBubble(path);
}

// The list is the bubbles the find would land on, so every row is pickable.
function renderSuggestions(box: HTMLInputElement): void {
  const rows: HTMLElement[] = [];
  const term = box.value.trim();
  if (term !== "") {
    for (const bubble of findMatchingBubbles(term.toLowerCase())) {
      const nameElement = bubble.querySelector<HTMLElement>(".fname")!;
      const path = nameElement.dataset.path ?? nameElement.textContent!;
      const row = document.createElement("div");
      row.className = "find-suggestion";
      row.dataset.path = path;
      row.textContent = path;
      row.addEventListener("click", () => pickSuggestion(box, path));
      rows.push(row);
    }
  }
  selectedSuggestionIndex = -1;
  getRequiredElementById("find-file-results").replaceChildren(...rows);
}

function attachFindBoxInputListeners(box: HTMLInputElement): void {
  function moveOnKey(event: Event): void {
    const key = (event as KeyboardEvent).key;
    const rows = listSuggestionRows();
    if (key === "ArrowDown") {
      event.preventDefault();
      markSelectedSuggestion(Math.min(selectedSuggestionIndex + 1, rows.length - 1));
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      markSelectedSuggestion(Math.max(selectedSuggestionIndex - 1, 0));
    }
    if (key === "Enter") {
      const selectedRow = rows[selectedSuggestionIndex];
      if (selectedRow !== undefined) {
        pickSuggestion(box, selectedRow.dataset.path!);
      }
      else {
        moveToNamedBubble(box.value);
      }
    }
  }
  function refreshSuggestionsAndClearOnEmptyInput(): void {
    renderSuggestions(box);
    const isBoxEmpty = box.value.trim() === "";
    if (isBoxEmpty) {
      clearFindState();
    }
  }
  box.addEventListener("keydown", moveOnKey);
  // `input`, not `keyup`: it fires for paste, cut, and the clear button, which a key listener misses.
  box.addEventListener("input", refreshSuggestionsAndClearOnEmptyInput);
}

function attachFindStepButtonListeners(box: HTMLInputElement): void {
  function moveToPreviousMatch(): void {
    moveToNamedBubble(box.value, -1);
  }
  function moveToNextMatch(): void {
    moveToNamedBubble(box.value, 1);
  }
  getRequiredElementById("find-prev").addEventListener("click", moveToPreviousMatch);
  getRequiredElementById("find-next").addEventListener("click", moveToNextMatch);
}

// The two buttons step the same cycle from whatever the box holds, so they read `box.value`.
export function initFindFileBox(): void {
  const box = getRequiredElementById("find-file") as HTMLInputElement;
  attachFindBoxInputListeners(box);
  attachFindStepButtonListeners(box);
}
