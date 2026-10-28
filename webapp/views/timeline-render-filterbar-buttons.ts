// Timeline filter bar button helpers: active-mode marking plus the raw-lines and re-ask-baseline header buttons.

import { clearBaselineChoice, getBaselineChoice } from "../app-choices.ts";
import { clearProjectDocuments } from "../app-fetch.ts";
import { renderRoute } from "../app-router.ts";
import { isAllLinesOn, toggleAllLinesSetting } from "./timeline-line-nodes.ts";

export const ACTIVE_BUTTON_CLASS = "active";

// Mark exactly one button of the group as the active mode.
export function markActiveButton(buttons: HTMLButtonElement[], activeButton: HTMLButtonElement): void {
  for (const button of buttons) {
    button.classList.toggle(ACTIVE_BUTTON_CLASS, button === activeButton);
  }
}

// Task 134: the raw-lines toggle changes node derivation, so it re-renders the whole route.
export function initAllLinesButton(): void {
  const allLinesButton = document.getElementById("all-lines-btn") as HTMLButtonElement;
  allLinesButton.classList.toggle(ACTIVE_BUTTON_CLASS, isAllLinesOn());
  allLinesButton.onclick = () => {
    toggleAllLinesSetting();
    void renderRoute();
  };
}

// Task 152: clear the stored baseline answer and cached documents so the next fetch asks again.
export function initReaskBaselineButton(project: string): void {
  const reaskBaselineButton = document.getElementById("reask-baseline-btn") as HTMLButtonElement;
  reaskBaselineButton.hidden = getBaselineChoice(project) === null;
  reaskBaselineButton.onclick = () => {
    clearBaselineChoice(project);
    clearProjectDocuments(project);
    void renderRoute();
  };
}
