// The Layer 1 page's zoom control (S18 feedback fixes, step 5). Split out of layer1-page.ts to keep
// that file under the 250-line cap; `applyZoom` plus its three listeners is a clean seam, since
// nothing else on the page reads the zoom level.
//
// ponytail: this is the NATIVE CSS `zoom` property, never `transform: scale()`. `zoom` participates
// in layout, so the scroll container's scrollable area shrinks with the content; `transform` does
// not, and would leave the page scrolling over a huge empty region when zoomed out. It also scales
// font size, so the ruler's tick labels shrink in step with the gaps between them — which is why
// layer1-page.ts's 13 px tick-label collision skip stays correct at every level and the ruler needs
// no re-render on zoom.

import { getRequiredElementById } from "./app-dom.ts";

// Zoom bounds and step. 1.25 per click is ~3 clicks per halving/doubling, and 0.1 shrinks the
// 832-widget jfred render to something that fits one screen. Vertical AND horizontal, because the
// render is oversized in both directions.
const ZOOM_STEP = 1.25;
export const ZOOM_MINIMUM = 0.1;
export const ZOOM_MAXIMUM = 4;

// The page's ONE zoom value, applied by CSS via `.canvas { zoom: var(--zoom, 1) }`.
let currentZoom = 1;

// Clamp, publish, and report. The property goes on `.viz-root` rather than on `.canvas` so `--zoom`
// is INHERITED and any future zoom-aware rule can read it without reaching across the tree;
// `.canvas` is the only element that CONSUMES it today.
export function applyZoom(requestedZoom: number): void {
    currentZoom = Math.min(Math.max(requestedZoom, ZOOM_MINIMUM), ZOOM_MAXIMUM);
    (document.querySelector(".viz-root") as HTMLElement).style.setProperty("--zoom", String(currentZoom));
    getRequiredElementById("zoom-level").textContent = `${Math.round(currentZoom * 100)}%`;
    // Native `zoom` re-lays-out the whole canvas but leaves scrollTop/scrollLeft where they were, so
    // a lit bubble ends up thousands of px outside the pane — the reader zooms out for context and
    // loses the very thing they had found. Re-anchoring on it is the same post-reflow re-centring
    // layer1-drawer.ts does when opening the drawer shrinks the pane.
    //
    // ponytail: the anchor is the SELECTION only. CEILING: with nothing lit, a zoom still pivots on
    // the scroll origin rather than on what is mid-screen. UPGRADE PATH if that is reported —
    // remember the pane's centre point before the property is set and scroll back to it after.
    document.querySelector(".filebox.found")?.scrollIntoView({ block: "start", inline: "center" });
}

// Wire the three buttons and set the opening level, so the readout starts at 100% rather than
// blank. Called once from bootLayer1Page.
export function wireZoomControls(): void {
    getRequiredElementById("zoom-in").addEventListener("click", () => applyZoom(currentZoom * ZOOM_STEP));
    getRequiredElementById("zoom-out").addEventListener("click", () => applyZoom(currentZoom / ZOOM_STEP));
    getRequiredElementById("zoom-reset").addEventListener("click", () => applyZoom(1));
    applyZoom(1);
}
