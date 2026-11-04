// Layer 1 run viewport: finds the script dots on screen and hands their run ids to the queue.

import { getRequiredElementById } from "./app-dom.ts";
import { readDrawnView } from "./layer1-diff-wash.ts";
import { isDotOnScreen, type PaneBounds } from "./layer1-dot-on-screen.ts";
import { addRunsToQueue } from "./layer1-run-queue.ts";

const DOT_SELECTOR = "i.node.n-script[data-tool-use-id]";
const DEBOUNCE_MS = 150;

let debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let observedCanvas: Element | null = null;

// A zero-sized dot is filter-hidden and drops out; a run with several dots is listed once.
export function listOnScreenRunIds(pane: PaneBounds, dots: HTMLElement[]): string[] {
  const ids = new Set<string>();
  for (const dot of dots) {
    const isOnScreen = isDotOnScreen(dot, pane);
    if (isOnScreen) {
      ids.add(dot.getAttribute("data-tool-use-id")!);
    }
  }
  return [...ids];
}

function scanViewport(): void {
  const view = readDrawnView();
  if (view === undefined) {
    return;
  }
  const pane = getRequiredElementById("timelines").getBoundingClientRect();
  const dots = [...document.querySelectorAll<HTMLElement>(DOT_SELECTOR)];
  void addRunsToQueue(view, listOnScreenRunIds(pane, dots));
}

function scheduleViewportCheck(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scanViewport,DEBOUNCE_MS);
}

// The observed canvas; observing it again from inside a draw would re-fire and loop forever.
function attachCanvasResizeObserver(): void {
  const canvas = document.querySelector(".canvas");
  const isNothingToObserve = canvas === null || canvas === observedCanvas;
  if (isNothingToObserve) {
    return;
  }
  observedCanvas = canvas;
  new window.ResizeObserver(scheduleViewportCheck).observe(canvas);
}

// ponytail: re-adding the SAME named function is a DOM no-op, so each draw keeps one scroll listener.
export function installRunViewportWatcher(): void {
  getRequiredElementById("timelines").addEventListener("scroll", scheduleViewportCheck);
  attachCanvasResizeObserver();
  scheduleViewportCheck();
}
