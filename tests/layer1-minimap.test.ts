// The Layer 1 page's minimap (task 246): the whole render shrunk into a corner plot, plus a
// rectangle marking the slice the scrollport is over.
//
// happy-dom implements NO layout — every rect is 0x0 at 0,0 and every client/scroll extent is 0 —
// so the measurements the module reads are stubbed onto the individual elements here and the
// assertions are made against the inline styles it WRITES. That is the whole contract worth
// pinning: the arithmetic that turns content px into plot px, and the fact that it is driven by
// measured boxes rather than by the zoom level (which is what keeps the map correct under the zoom
// control — see webapp/layer1-minimap.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { drawLayer1Minimap, fitMinimapScale } from "../webapp/layer1-minimap.ts";

// The stubbed pane: a 1000x500 render seen through a 200x100 scrollport, mapped into a 100x50 plot.
// Both ratios are 0.1, so every expectation below is the content value divided by ten.
const CONTENT_WIDTH_PX = 1000;
const CONTENT_HEIGHT_PX = 500;
const PANE_WIDTH_PX = 200;
const PANE_HEIGHT_PX = 100;
const PLOT_WIDTH_PX = 100;
const PLOT_HEIGHT_PX = 50;

interface StubbedRect {
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
}

// Give one element a fixed box. happy-dom defines these on the PROTOTYPE as getters, so an own
// property on the instance shadows them for this element alone.
function stubMeasurements(element: Element, sizes: Record<string, number>, rect: StubbedRect): void {
    for (const [property, value] of Object.entries(sizes)) {
        Object.defineProperty(element, property, { value, configurable: true });
    }
    Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
            left: rect.leftPx, top: rect.topPx, width: rect.widthPx, height: rect.heightPx,
        } as unknown as DOMRect),
    });
}

function findRequiredElement(selector: string): HTMLElement {
    const element = document.querySelector(selector);
    assert.notEqual(element, null, `page markup is missing ${selector}`);
    return element as HTMLElement;
}

function appendWidget(className: string, rect: StubbedRect): void {
    const widget = document.createElement("div");
    widget.className = className;
    stubMeasurements(widget, {}, rect);
    document.getElementById("stage")!.append(widget);
}

// A page carrying two widgets — one pair bubble and one orphan bucket — with the pane and plot
// measurements above. The pane's own rect sits at the viewport origin so a widget's client-space
// left/top IS its content-space left/top when nothing is scrolled.
function openMappedPage(): HTMLElement {
    setupLayer1Dom();
    const pane = findRequiredElement("main.timelines");
    stubMeasurements(pane, {
        scrollWidth: CONTENT_WIDTH_PX, scrollHeight: CONTENT_HEIGHT_PX,
        clientWidth: PANE_WIDTH_PX, clientHeight: PANE_HEIGHT_PX,
    }, { leftPx: 0, topPx: 0, widthPx: PANE_WIDTH_PX, heightPx: PANE_HEIGHT_PX });
    stubMeasurements(findRequiredElement(".mm-plot"), {
        clientWidth: PLOT_WIDTH_PX, clientHeight: PLOT_HEIGHT_PX,
    }, { leftPx: 0, topPx: 0, widthPx: PLOT_WIDTH_PX, heightPx: PLOT_HEIGHT_PX });
    appendWidget("filebox", { leftPx: 100, topPx: 50, widthPx: 168, heightPx: 40 });
    appendWidget("filebox bucket", { leftPx: 600, topPx: 300, widthPx: 10, heightPx: 10 });
    return pane;
}

function readPlacement(element: HTMLElement): string[] {
    return [element.style.left, element.style.top, element.style.width, element.style.height];
}

test("test_minimap_scale_fits_the_whole_render_into_the_plot", () => {
    // Scenario (task 246): the map is only useful if the ENTIRE render fits inside it, so the
    // tighter of the two axes sets the scale.
    // Steps:
    // a render twice as wide as it is tall, in a square plot — width is the binding axis.
    assert.equal(fitMinimapScale(1000, 500, 100, 100), 0.1);
    // the same plot against a render twice as TALL — now height binds, and the width ratio loses.
    assert.equal(fitMinimapScale(500, 1000, 100, 100), 0.1);
    // an unrendered page reports every extent as 0; the scale must be a number, not Infinity.
    assert.equal(fitMinimapScale(0, 0, 100, 50), 50);
});

test("test_minimap_draws_one_scaled_mark_per_widget", () => {
    // Scenario (task 246): every bubble on the canvas appears on the map at its own scaled-down
    // position, with the orphan buckets distinguishable from the pair widgets.
    // Steps:
    // draw the map over a two-widget render.
    openMappedPage();
    drawLayer1Minimap();
    const marks = [...document.querySelectorAll(".mm-box")] as HTMLElement[];
    assert.equal(marks.length, 2);
    // the pair bubble lands at a tenth of its content position and a tenth of its size.
    assert.deepEqual(readPlacement(marks[0]!), ["10px", "5px", "16.8px", "4px"]);
    // the bucket keeps its own class, and its 10x10 box — 1 px once scaled — is floored at the
    // 1.5 px minimum rather than rounding away to nothing.
    assert.equal(marks[1]!.className, "mm-box bucket");
    assert.deepEqual(readPlacement(marks[1]!), ["60px", "30px", "1.5px", "1.5px"]);
    // the viewport rectangle is the LAST child, so it paints over the marks rather than under them.
    assert.equal(findRequiredElement(".mm-plot").lastElementChild?.id, "mm-view");
});

test("test_minimap_viewport_rectangle_follows_the_pane_scroll", () => {
    // Scenario (task 246): the pane's scrollbars only appear mid-scroll, so the rectangle is the
    // only at-rest indication of where in the render the reader is standing. It must track a scroll
    // WITHOUT a re-render — the marks do not move, only the rectangle does.
    // Steps:
    // draw the map, then scroll the pane and let its own scroll event drive the update.
    const pane = openMappedPage();
    drawLayer1Minimap();
    assert.deepEqual(readPlacement(findRequiredElement(".mm-view")), ["0px", "0px", "20px", "10px"]);
    pane.scrollLeft = 300;
    pane.scrollTop = 200;
    pane.dispatchEvent(new window.Event("scroll"));
    // scrolled to a tenth of the offsets; the size is the scrollport, unchanged by scrolling.
    assert.deepEqual(readPlacement(findRequiredElement(".mm-view")), ["30px", "20px", "20px", "10px"]);
});

test("test_clicking_the_minimap_centres_the_pane_on_that_point", () => {
    // Scenario (task 246): the map doubles as a navigation control — a click jumps the pane to that
    // part of the render, CENTRED rather than top-left-aligned, so the clicked point is what the
    // reader ends up looking at.
    // Steps:
    // capture what the pane is ASKED to scroll to — happy-dom's own scrollTo clamps against its
    // internal (unstubbed, therefore zero) content extent, so the request is the observable here.
    const pane = openMappedPage();
    let requested: ScrollToOptions | undefined;
    Object.defineProperty(pane, "scrollTo", {
        configurable: true,
        value: (options: ScrollToOptions) => {
            requested = options;
        },
    });
    drawLayer1Minimap();
    // click a point 50 plot-px across and 20 down.
    findRequiredElement(".mm-plot").dispatchEvent(
        new window.MouseEvent("click", { clientX: 50, clientY: 20, bubbles: true }),
    );
    // 50 / 0.1 = content x 500, less half the 200 px scrollport; 20 / 0.1 = 200, less half of 100.
    assert.equal(requested?.left, 400);
    assert.equal(requested?.top, 150);
});
