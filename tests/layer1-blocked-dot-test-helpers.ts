// Test helper: puts a script dot with faked screen rects into the Layer 1 canvas for the blocked popup.

import { createElement } from "../webapp/app-dom.ts";

export function buildRect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect;
}

// Default pane: 1000 by 600 at the origin. Default canvas: scrolled 100 left and 50 up.
export const DEFAULT_PANE = buildRect(0, 0, 1000, 600);
export const DEFAULT_CANVAS = buildRect(-100, -50, 3000, 2000);
export const DEFAULT_DOT = buildRect(200, 100, 8, 8);

export function appendBlockedDot(toolUseId: string, dot: DOMRect = DEFAULT_DOT, pane: DOMRect = DEFAULT_PANE, canvas: DOMRect = DEFAULT_CANVAS): HTMLElement {
  const timelines = document.getElementById("timelines")!;
  const canvasElement = timelines.querySelector<HTMLElement>(".canvas")!;
  timelines.getBoundingClientRect = () => pane;
  canvasElement.getBoundingClientRect = () => canvas;
  const dotElement = createElement("i", { class: "node n-script", "data-tool-use-id": toolUseId });
  dotElement.getBoundingClientRect = () => dot;
  canvasElement.append(dotElement);
  return dotElement;
}
