// Layer 1's jump-to-bubble box; native scrollIntoView is used because offsetTop is unscaled when zoomed.

import { getRequiredElementById } from "./app-dom.ts";
import { addSlackForEdgeNode } from "./layer1-find-slack.ts";
import { listNameElements, reportFindStatus, resetFindCycle, selectMatchAtStep } from "./layer1-find-match.ts";

// A list because a landing lights the row and its owning bubble.
let litElements: HTMLElement[] = [];

// Fired on `document` when a jump lands; layer1-leader-visibility.ts keeps that element's dashed leader line up.
export const LANDED_EVENT = "layer1-landed";

// Only one thing carries `.found` at a time, and it stays lit (user, 2026-07-26).
export function highlightLandedElement(landed: HTMLElement): void {
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

// Centres the element in the part of #timelines the Details drawer leaves uncovered.
export function scrollToUncoveredCentre(element: HTMLElement): void {
  const pane = getRequiredElementById("timelines");
  const view = pane.getBoundingClientRect();
  const drawer = getRequiredElementById("drawer").getBoundingClientRect();
  const area = { left: view.left, right: view.right, top: view.top, bottom: view.bottom };
  const isCovered = Math.min(view.right, drawer.right) > Math.max(view.left, drawer.left)
        && Math.min(view.bottom, drawer.bottom) > Math.max(view.top, drawer.top);
  const coversFullHeight = drawer.top <= view.top && drawer.bottom >= view.bottom;
  if (isCovered && coversFullHeight && drawer.left > view.left) {
    area.right = drawer.left;
  }
  else if (isCovered && coversFullHeight) {
    area.left = drawer.right;
  }
  else if (isCovered && drawer.top > view.top) {
    area.bottom = drawer.top;
  }
  else if (isCovered) {
    area.top = drawer.bottom;
  }
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
  highlightLandedElement(bubble);
}

// Jump to the next (or, with step -1, the previous) bubble named by `term`.
export function jumpToNamedBubble(term: string, step: number = 1): HTMLElement | undefined {
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

// The File Nav's caller: a leaf knows its exact path, so it needs no substring match or cycle.
export function jumpToBubbleAtPath(path: string): HTMLElement | undefined {
  let owner: HTMLElement | undefined;
  for (const nameElement of listNameElements()) {
    const isOwner = nameElement.dataset.path === path;
    if (isOwner) {
      owner = nameElement;
      break;
    }
  }
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

// The two buttons step the same cycle from whatever the box holds, so they read `box.value`.
export function wireFindFileBox(): void {
  const box = getRequiredElementById("find-file") as HTMLInputElement;
  box.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      jumpToNamedBubble(box.value);
    }
  });
  // `input`, not `keyup`: it fires for paste, cut, and the clear button, which a key listener misses.
  box.addEventListener("input", () => {
    if (box.value.trim() !== "") {
      return;
    }
    clearFindState();
  });
  getRequiredElementById("find-prev").addEventListener("click", () => {
    jumpToNamedBubble(box.value, -1);
  });
  getRequiredElementById("find-next").addEventListener("click", () => {
    jumpToNamedBubble(box.value, 1);
  });
}
