// Layer 1's find-box matching and cycling: which bubbles match a term, and which one a submit lands on.

import { getRequiredElementById } from "./app-dom.ts";

// Module scope because the cycle is the feature: resubmitting the same term advances, not restarts.
let cycledTerm = "";
let cycleIndex = 0;

// `.fname` holds both matchable strings: its text is the basename, its `data-path` the full path.
export function listNameElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")];
}

// One case-insensitive substring test over the full path; falls back to text for label-only buckets.
function isMatchingSearchTerm(nameElement: HTMLElement, lowerTerm: string): boolean {
  const haystack = nameElement.dataset.path ?? nameElement.textContent ?? "";
  return haystack.toLowerCase().includes(lowerTerm);
}

// A collision is not an error: an ambiguous term yields a list that repeat-submit cycles through.
function findMatchingBubbles(lowerTerm: string): HTMLElement[] {
  const bubbles: HTMLElement[] = [];
  for (const nameElement of listNameElements()) {
    const isMatch = isMatchingSearchTerm(nameElement, lowerTerm);
    if (isMatch) {
      bubbles.push(nameElement.closest(".filebox") as HTMLElement);
    }
  }
  return bubbles;
}

// Every submit reports here, in its own element, since the header's #crumb is destroyed by a search.
export function reportFindStatus(message: string): void {
  getRequiredElementById("find-status").textContent = message;
}

export function resetFindCycle(): void {
  cycledTerm = "";
  cycleIndex = 0;
}

// Adding `matches.length` before the modulo wraps step -1 to the last match, not a negative index.
export function selectMatchAtStep(term: string, step: number): HTMLElement | undefined {
  const matches = findMatchingBubbles(term.toLowerCase());
  if (matches.length === 0) {
    cycledTerm = "";
    reportFindStatus(`find "${term}": no bubble matches`);
    return undefined;
  }
  cycleIndex = term === cycledTerm ? (cycleIndex + step + matches.length) % matches.length : 0;
  cycledTerm = term;
  const landed = matches[cycleIndex]!;
  const landedPath = landed.querySelector<HTMLElement>(".fname")?.dataset.path ?? term;
  reportFindStatus(`find "${term}": ${cycleIndex + 1} of ${matches.length} · ${landedPath}`);
  return landed;
}
