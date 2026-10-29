// Consent dialog header navigation: Prev/Next buttons stepping a selection through the visible script rows.

import { type WireConsentScript } from "./app-fetch.ts";
import { computeConsentSelectionStep, findDefaultConsentSelectionIndex } from "./app-consent-model.ts";

export type ConsentNavControls = { prevButton: HTMLButtonElement; nextButton: HTMLButtonElement; navCounter: HTMLElement };

// Grouping is contiguous and order-preserving, so listConsentRows()[i] matches scripts[i].
function listConsentRows(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(".consent-script")];
}

function collectVisibleConsentRows(box: HTMLElement): HTMLElement[] {
  const visibleRows: HTMLElement[] = [];
  for (const row of listConsentRows(box)) {
    const closedAncestor = row.closest("details:not([open])");
    if (closedAncestor === null) {
      visibleRows.push(row);
    }
  }
  return visibleRows;
}

export function attachConsentNavigation(box: HTMLElement, scripts: WireConsentScript[], controls: ConsentNavControls): void {
  const { prevButton, nextButton, navCounter } = controls;
  const defaultIndex = findDefaultConsentSelectionIndex(scripts);
  let selectedRow: HTMLElement | undefined = defaultIndex === undefined ? undefined : listConsentRows(box)[defaultIndex];
  function updateScriptNavState(): void {
    const visibleRows = collectVisibleConsentRows(box);
    const isSelectionVisible = selectedRow !== undefined && visibleRows.includes(selectedRow);
    if (!isSelectionVisible) {
      // Fall back to the first visible row so the selection never sits on a hidden script.
      selectedRow = visibleRows[0];
    }
    for (const row of listConsentRows(box)) {
      row.classList.toggle("consent-selected", row === selectedRow);
    }
    const nothingNavigable = visibleRows.length === 0;
    prevButton.hidden = nothingNavigable;
    nextButton.hidden = nothingNavigable;
    navCounter.hidden = nothingNavigable;
    if (selectedRow !== undefined) {
      const selectedIndex = visibleRows.indexOf(selectedRow);
      prevButton.disabled = selectedIndex <= 0;
      nextButton.disabled = selectedIndex >= visibleRows.length - 1;
      navCounter.textContent = `Script ${selectedIndex + 1} of ${visibleRows.length}`;
    }
  }
  function moveConsentSelection(delta: number): void {
    const visibleRows = collectVisibleConsentRows(box);
    if (visibleRows.length === 0) {
      return;
    }
    const currentIndex = selectedRow === undefined ? -1 : visibleRows.indexOf(selectedRow);
    selectedRow = visibleRows[computeConsentSelectionStep(currentIndex, delta, visibleRows.length)];
    updateScriptNavState();
    selectedRow?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  prevButton.onclick = () => moveConsentSelection(-1);
  nextButton.onclick = () => moveConsentSelection(1);
  // Toggle events only surface in the capture phase, so one listener covers every expand path.
  box.addEventListener("toggle", updateScriptNavState, true);
  updateScriptNavState();
}
