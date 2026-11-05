// Layer 1 blocked popup (task 358, part O): tells the user that earlier script dots must run first.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { isDotOnScreen, type PaneBounds } from "./layer1-dot-on-screen.ts";
import { BlockerState, type Blocker } from "./layer1-run-order.ts";
import { getCurrentZoom } from "./layer1-zoom.ts";

const POPUP_ID = "run-blocked-popup";
const POPUP_WIDTH = 360;
const POPUP_GAP = 8;
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

function buildBlockedPopup(dotKey: string, blocker: Blocker, blockerFileName: string, onGoToFirst: () => void): HTMLElement {
  return createElement("div", { id: POPUP_ID, class: "run-blocked-popup" }, [
    createElement("p", { class: "blocked-text", text: BLOCKED_TEXT }),
    createElement("p", { class: "blocked-text blocked-first", text: `${blockerFileName}: ${STATE_TEXT[blocker.state]}` }),
    buildBlockedButtons(dotKey, onGoToFirst),
  ]);
}

function findOnScreenDot(toolUseId: string, pane: PaneBounds): HTMLElement | undefined {
  const dots = document.querySelectorAll<HTMLElement>(`i.node.n-script[data-tool-use-id="${toolUseId}"]`);
  for (const dot of dots) {
    const isOnScreen = isDotOnScreen(dot, pane);
    if (isOnScreen) {
      return dot;
    }
  }
  // throw new Error(`no on-screen dot for script ${toolUseId}`);
  return undefined;
}

// Divide screen rects by zoom for canvas units. Place right of dot, left if no room.
function setPopupBesideDot(popup: HTMLElement, dot: DOMRect, canvas: DOMRect, pane: PaneBounds): void {
  const zoom = getCurrentZoom();
  const isRoomRight = dot.right + (POPUP_GAP + POPUP_WIDTH) * zoom <= pane.right;
  const screenLeft = isRoomRight ? dot.right + POPUP_GAP * zoom : dot.left - (POPUP_GAP + POPUP_WIDTH) * zoom;
  popup.style.left = `${(screenLeft - canvas.left) / zoom}px`;
  popup.style.top = `${(dot.top - canvas.top) / zoom}px`;
}

// One popup at a time; a closed dot stays quiet.
export function renderBlockedPopup(dotKey: string, toolUseId: string, blocker: Blocker, blockerFileName: string, onGoToFirst: () => void): void {
  const isDismissed = dismissedDotKeys.has(dotKey);
  if (isDismissed) {
    return;
  }
  const pane = getRequiredElementById("timelines").getBoundingClientRect();
  const dot = findOnScreenDot(toolUseId, pane);
  if (dot === undefined) {
    return;
  }
  closeBlockedPopup();
  const canvas = getRequiredElementById("timelines").querySelector<HTMLElement>(".canvas")!;
  const popup = buildBlockedPopup(dotKey, blocker, blockerFileName, onGoToFirst);
  canvas.append(popup);
  setPopupBesideDot(popup, dot.getBoundingClientRect(), canvas.getBoundingClientRect(), pane);
}
