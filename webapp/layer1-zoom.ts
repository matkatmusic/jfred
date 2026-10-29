// Layer 1 zoom control, split out of layer1-page.ts to keep that file under the 250-line cap.
// ponytail: native CSS `zoom`, never `transform: scale()`: `zoom` shrinks the scrollable area, and it scales tick labels too.

import { getRequiredElementById } from "./app-dom.ts";

// Zoom bounds and step: 1.25 per click, and 0.1 shrinks the 832-widget render to fit one screen.
const ZOOM_STEP = 1.25;
export const ZOOM_MINIMUM = 0.1;
export const ZOOM_MAXIMUM = 4;

// The page's ONE zoom value, applied by CSS via `.canvas { zoom: var(--zoom, 1) }`.
let currentZoom = 1;

// Clamp, publish, and report. `--zoom` goes on `.viz-root` so any zoom-aware rule inherits it; only `.canvas` uses it today.
export function applyZoom(requestedZoom: number): void {
  currentZoom = Math.min(Math.max(requestedZoom, ZOOM_MINIMUM), ZOOM_MAXIMUM);
  (document.querySelector(".viz-root") as HTMLElement).style.setProperty("--zoom", String(currentZoom));
  getRequiredElementById("zoom-level").textContent = `${Math.round(currentZoom * 100)}%`;
  // Native `zoom` keeps the scroll position, so a lit bubble drifts off screen; re-anchor on it, as layer1-drawer.ts does.
  // ponytail: anchor is the selection only; with nothing lit, zoom pivots on the scroll origin. Upgrade: save pane centre.
  document.querySelector(".filebox.found")?.scrollIntoView({ block: "start", inline: "center" });
}

// Wire the three buttons and set the opening level so the readout starts at 100%.
function applyZoomIn(): void {
  applyZoom(currentZoom * ZOOM_STEP);
}

function applyZoomOut(): void {
  applyZoom(currentZoom / ZOOM_STEP);
}

function resetZoom(): void {
  applyZoom(1);
}

export function attachZoomControls(): void {
  getRequiredElementById("zoom-in").addEventListener("click", applyZoomIn);
  getRequiredElementById("zoom-out").addEventListener("click", applyZoomOut);
  getRequiredElementById("zoom-reset").addEventListener("click", resetZoom);
  applyZoom(1);
}

