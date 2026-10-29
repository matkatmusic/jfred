// The Layer 1 minimap (task 246): one mark per widget plus a viewport rectangle, in `.stagewrap`.
// ponytail: every number is MEASURED, never derived from zoom, so the minimap stays correct under zoom.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { applyBoxToPlot, computeMinimapScale, measureInContent } from "./layer1-minimap-geometry.ts";
import type { MinimapScale } from "./layer1-minimap-geometry.ts";

// The scroll container. It carries an id purely so this module and the page share one lookup.
function getTimelinePane(): HTMLElement {
  return getRequiredElementById("timelines");
}

// The inner box the marks are drawn into; it carries the current scale in data attributes.
function getMinimapPlot(): HTMLElement {
  return getRequiredElementById("mm-plot");
}

function readMinimapScale(): MinimapScale {
  const plot = getMinimapPlot();
  return {
    xPerContentPx: Number(plot.dataset["scaleX"] ?? 0),
    yPerContentPx: Number(plot.dataset["scaleY"] ?? 0),
  };
}

// One `.wash` band's minimap mark: measured like a `.filebox` mark, plus its tint.
function buildWashMark(wash: Element, pane: HTMLElement, paneRect: DOMRect, scale: MinimapScale): HTMLElement {
  const mark = createElement("div", { class: "mm-wash" });
  applyBoxToPlot(mark, measureInContent(wash, pane, paneRect), scale);
  mark.style.setProperty("--wash-color", (wash as HTMLElement).style.getPropertyValue("--wash-color"));
  return mark;
}

// Move the viewport rectangle to the pane's scroll position; the only work per scroll event.
export function syncMinimapViewport(): void {
  const pane = getTimelinePane();
  applyBoxToPlot(getRequiredElementById("mm-view"), {
    leftPx: pane.scrollLeft,
    topPx: pane.scrollTop,
    widthPx: pane.clientWidth,
    heightPx: pane.clientHeight,
  }, readMinimapScale());
}

// Click the map to centre the pane on that point; a scale of 0 means nothing is drawn.
function moveViewportToMinimapPoint(event: Event): void {
  const scale = readMinimapScale();
  const isXUnset = scale.xPerContentPx <= 0;
  const isYUnset = scale.yPerContentPx <= 0;
  const isNothingDrawn = isXUnset || isYUnset;
  if (isNothingDrawn) {
    return;
  }
  const { clientX, clientY } = event as MouseEvent;
  const pane = getTimelinePane();
  const plotRect = getMinimapPlot().getBoundingClientRect();
  pane.scrollTo({
    left: (clientX - plotRect.left) / scale.xPerContentPx - pane.clientWidth / 2,
    top: (clientY - plotRect.top) / scale.yPerContentPx - pane.clientHeight / 2,
    behavior: "smooth",
  });
}

// ponytail: re-adding the SAME named function is a DOM no-op, so each draw keeps one listener.
function registerMinimapListeners(): void {
  getTimelinePane().addEventListener("scroll", syncMinimapViewport);
  getMinimapPlot().addEventListener("click", moveViewportToMinimapPoint);
}

// The observed canvas; observing it again from inside a draw would re-fire and loop forever.
let observedCanvas: Element | null = null;

// Redraw when the canvas changes size, which also keeps ZOOM correct without reading it.
function registerCanvasResizeObserver(): void {
  const canvas = document.querySelector(".canvas");
  const isCanvasMissing = canvas === null;
  const isCanvasObserved = canvas === observedCanvas;
  const isNothingToObserve = isCanvasMissing || isCanvasObserved;
  if (isNothingToObserve) {
    return;
  }
  observedCanvas = canvas;
  new window.ResizeObserver(() => renderLayer1Minimap()).observe(canvas);
}

// Rebuild the whole map after every render and every canvas resize.
export function renderLayer1Minimap(): void {
  const pane = getTimelinePane();
  const plot = getMinimapPlot();
  const scale = computeMinimapScale(pane.scrollWidth, pane.scrollHeight, plot.clientWidth, plot.clientHeight);
  plot.dataset["scaleX"] = String(scale.xPerContentPx);
  plot.dataset["scaleY"] = String(scale.yPerContentPx);
  const paneRect = pane.getBoundingClientRect();
  // Washes paint BEHIND file marks, mirroring the real canvas's `.washes { z-index: -1 }` stacking.
  const washMarks: HTMLElement[] = [];
  for (const wash of document.querySelectorAll("#washes .wash")) {
    washMarks.push(buildWashMark(wash, pane, paneRect, scale));
  }
  const marks: HTMLElement[] = [];
  for (const widget of document.querySelectorAll(".filebox")) {
    // Orphan buckets are `.filebox.bucket`; they read as muted on the map, as on the canvas.
    const mark = createElement("div", { class: widget.classList.contains("bucket") ? "mm-box bucket" : "mm-box" });
    applyBoxToPlot(mark, measureInContent(widget, pane, paneRect), scale);
    marks.push(mark);
  }
  // The viewport rectangle is re-appended LAST so it paints over the marks.
  plot.replaceChildren(...washMarks, ...marks, getRequiredElementById("mm-view"));
  syncMinimapViewport();
  registerMinimapListeners();
  registerCanvasResizeObserver();
}
