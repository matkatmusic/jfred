// The Layer 1 page's minimap (task 246), per plans/layer1-mockup.html: the whole render shrunk into
// a 176x124 plot in the LOWER-LEFT corner of the timeline pane, with one mark per widget and a
// rectangle showing which slice of it the scrollport is currently over. The pane's scrollbars only
// surface while a scroll is in flight, so at rest a 156,000 px-wide render gave no clue where the
// reader was standing.
//
// It lives in `.stagewrap` — a non-scrolling wrapper AROUND `main.timelines` — never inside the
// scroll container itself, so it stays pinned to the pane's corner while the canvas scrolls under
// it. Split out of layer1-page.ts because that file is at the 250-line cap.
//
// ponytail: every number below is MEASURED, never derived from the zoom level, which is what keeps
// the minimap correct under the zoom control (webapp/layer1-zoom.ts). Native CSS `zoom` participates
// in LAYOUT, so the pane's scrollWidth/scrollHeight/scrollLeft already describe the zoomed content,
// and getBoundingClientRect already reports zoomed on-screen boxes. Both live in the unzoomed
// scrollport's coordinate space — `.timelines` is outside the `zoom`ed `.canvas` — so the two mix
// without a correction factor, and this module never reads `--zoom` at all.

import { el, getRequiredElementById } from "./app-dom.ts";

// A 168 px bubble in a 176 px plot of a 156,000 px render scales to under a tenth of a pixel, which
// browsers drop. 1.5 px keeps every widget on the map as a visible speck.
const MINIMUM_MARK_PX = 1.5;

// A box in CONTENT coordinates: the scrollport's padding-box origin, which is the same origin
// scrollLeft/scrollTop count from, so a scroll offset and a widget offset are directly comparable.
interface ContentBoxPx {
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
}

// Plot px per content px. The map is only useful if the WHOLE render fits inside it, so the tighter
// of the two axes wins. The Math.max guards a division by zero on the pre-render page (no widgets
// yet) and under happy-dom, which implements no layout and reports every extent as 0.
export function fitMinimapScale(
    contentWidthPx: number,
    contentHeightPx: number,
    plotWidthPx: number,
    plotHeightPx: number,
): number {
    return Math.min(plotWidthPx / Math.max(contentWidthPx, 1), plotHeightPx / Math.max(contentHeightPx, 1));
}

// The scroll container. It carries an id purely so this module and the page share one lookup.
function getTimelinePane(): HTMLElement {
    return getRequiredElementById("timelines");
}

// The clipped inner box the marks are drawn into. It also CARRIES the current scale, in a data
// attribute, so the scroll and click handlers below need no module-level state that could drift out
// of step with what is actually on screen.
function getMinimapPlot(): HTMLElement {
    return getRequiredElementById("mm-plot");
}

function readMinimapScale(): number {
    return Number(getMinimapPlot().dataset["scale"] ?? 0);
}

// Place one absolutely-positioned rectangle inside the plot. Used for both a widget mark and the
// viewport rectangle — they differ only in which content box they are handed.
function positionInPlot(target: HTMLElement, box: ContentBoxPx, scale: number): void {
    target.style.left = `${box.leftPx * scale}px`;
    target.style.top = `${box.topPx * scale}px`;
    target.style.width = `${Math.max(box.widthPx * scale, MINIMUM_MARK_PX)}px`;
    target.style.height = `${Math.max(box.heightPx * scale, MINIMUM_MARK_PX)}px`;
}

// One rendered widget's content-space box. `paneRect` is passed in rather than re-read per widget:
// the real render has 833 of them and the pane's own box does not move between them.
function measureInContent(widget: Element, pane: HTMLElement, paneRect: DOMRect): ContentBoxPx {
    const rect = widget.getBoundingClientRect();
    return {
        leftPx: rect.left - paneRect.left + pane.scrollLeft,
        topPx: rect.top - paneRect.top + pane.scrollTop,
        widthPx: rect.width,
        heightPx: rect.height,
    };
}

// Move the viewport rectangle to wherever the pane is currently scrolled. This is the ONLY thing
// that runs per scroll event — the marks do not move, so a scroll never re-measures the render.
export function syncMinimapViewport(): void {
    const pane = getTimelinePane();
    positionInPlot(getRequiredElementById("mm-view"), {
        leftPx: pane.scrollLeft,
        topPx: pane.scrollTop,
        widthPx: pane.clientWidth,
        heightPx: pane.clientHeight,
    }, readMinimapScale());
}

// Click the map to centre the pane on that point. `scale` of 0 means nothing has been drawn yet, in
// which case there is no position to scroll to.
function scrollToMinimapPoint(event: Event): void {
    const scale = readMinimapScale();
    if (scale <= 0) {
        return;
    }
    const { clientX, clientY } = event as MouseEvent;
    const pane = getTimelinePane();
    const plotRect = getMinimapPlot().getBoundingClientRect();
    pane.scrollTo({
        left: (clientX - plotRect.left) / scale - pane.clientWidth / 2,
        top: (clientY - plotRect.top) / scale - pane.clientHeight / 2,
        behavior: "smooth",
    });
}

// ponytail: re-registering the SAME function reference for the same event on the same element is a
// no-op per the DOM spec, so calling this on every draw keeps exactly one of each listener — no
// "already wired" flag and no unwiring pass. (Named functions, therefore: an inline arrow would be a
// fresh reference every call and would stack up.)
function wireMinimapListeners(): void {
    getTimelinePane().addEventListener("scroll", syncMinimapViewport);
    getMinimapPlot().addEventListener("click", scrollToMinimapPoint);
}

// The canvas currently under observation. A ResizeObserver re-`observe`d with a target it already
// watches re-fires immediately, which from inside a draw would loop forever — hence the guard
// rather than an unconditional observe.
let observedCanvas: Element | null = null;

// Redraw whenever the canvas changes size. That is what makes ZOOM correct without this module
// knowing zoom exists: `zoom` resizes the canvas's layout box, the observer fires, and the map is
// rebuilt against the new extent. It also covers a window resize and any future content change.
function observeCanvasResize(): void {
    const canvas = document.querySelector(".canvas");
    if (canvas === null || canvas === observedCanvas) {
        return;
    }
    observedCanvas = canvas;
    new window.ResizeObserver(() => drawLayer1Minimap()).observe(canvas);
}

// Rebuild the whole map: one mark per widget bubble, plus the viewport rectangle. Called after every
// render, and by the resize observer above.
export function drawLayer1Minimap(): void {
    const pane = getTimelinePane();
    const plot = getMinimapPlot();
    const scale = fitMinimapScale(pane.scrollWidth, pane.scrollHeight, plot.clientWidth, plot.clientHeight);
    plot.dataset["scale"] = String(scale);
    const paneRect = pane.getBoundingClientRect();
    const marks = [...document.querySelectorAll(".filebox")].map((widget) => {
        // The two orphan buckets are `.filebox.bucket`; they read as muted on the map exactly as
        // they do on the canvas, so a speck is identifiable without hovering it.
        const mark = el("div", { class: widget.classList.contains("bucket") ? "mm-box bucket" : "mm-box" });
        positionInPlot(mark, measureInContent(widget, pane, paneRect), scale);
        return mark;
    });
    // The viewport rectangle is re-appended LAST so it paints over the marks.
    plot.replaceChildren(...marks, getRequiredElementById("mm-view"));
    syncMinimapViewport();
    wireMinimapListeners();
    observeCanvasResize();
}
