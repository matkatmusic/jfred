// Layer 1 blocked popup (task 358, part O): tells the user that earlier script dots must run first.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { BlockerState, type Blocker } from "./layer1-run-order.ts";

const POPUP_ID = "run-blocked-popup";
const BLOCKED_TEXT = "The earlier script dots must run first.";

const STATE_TEXT: Record<BlockerState, string> = {
  [BlockerState.unreplayed]: "not run yet",
  [BlockerState.crashed]: "crashed or timed out",
  [BlockerState.cancelled]: "cancelled",
};

// Keys of dots whose popup the user closed on this page open.
const dismissedDotKeys = new Set<string>();

export function closeBlockedPopup(): void {
  document.getElementById(POPUP_ID)?.remove();
}

function closeDotPopup(dotKey: string): void {
  dismissedDotKeys.add(dotKey);
  closeBlockedPopup();
}

function triggerGoToFirst(onGoToFirst: () => void): void {
  closeBlockedPopup();
  onGoToFirst();
}

function buildBlockedButtons(dotKey: string, onGoToFirst: () => void): HTMLElement {
  return createElement("div", { class: "blocked-buttons" }, [
    createElement("button", { class: "blocked-close", text: "close", onclick: () => closeDotPopup(dotKey) }),
    createElement("button", { class: "blocked-go", text: "Go to first unreplayed script node", onclick: () => triggerGoToFirst(onGoToFirst) }),
  ]);
}

function buildBlockedPopup(dotKey: string, blocker: Blocker, onGoToFirst: () => void): HTMLElement {
  return createElement("div", { id: POPUP_ID, class: "run-blocked-popup" }, [
    createElement("p", { class: "blocked-text", text: BLOCKED_TEXT }),
    createElement("p", { class: "blocked-text blocked-first", text: `${blocker.toolUseId}: ${STATE_TEXT[blocker.state]}` }),
    buildBlockedButtons(dotKey, onGoToFirst),
  ]);
}

// One popup at a time; a closed dot stays quiet.
export function renderBlockedPopup(dotKey: string, blocker: Blocker, onGoToFirst: () => void): void {
  const isDismissed = dismissedDotKeys.has(dotKey);
  if (isDismissed) {
    return;
  }
  closeBlockedPopup();
  getRequiredElementById("stagewrap").append(buildBlockedPopup(dotKey, blocker, onGoToFirst));
}
