// The Layer 1 page's minimap (task 246).
//
// happy-dom implements NO layout — every rect is 0x0 and every extent is 0 — so measurements are
// stubbed per element and assertions read the inline styles the module WRITES.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { drawLayer1Minimap, fitMinimapScale } from "../webapp/layer1-minimap.ts";

// Keep the two axis ratios UNEQUAL (x 0.1, y 0.2): a fixture whose axes agree cannot tell a
// per-axis scale from a single uniform one, and a uniform scale shipped undetected once.
const CONTENT_WIDTH_PX = 1000;
const CONTENT_HEIGHT_PX = 250;
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

// happy-dom defines these on the PROTOTYPE as getters, so an own property shadows them per element.
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

// The pane's rect sits at the viewport origin so a widget's client-space left/top IS its
// content-space left/top when nothing is scrolled.
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
    appendWidget("filebox bucket", { leftPx: 600, topPx: 100, widthPx: 10, heightPx: 10 });
    return pane;
}

function readPlacement(element: HTMLElement): string[] {
    return [element.style.left, element.style.top, element.style.width, element.style.height];
}

test("test_minimap_scale_fits_each_axis_to_its_own_extent", () => {
    // Each axis scales to ITS OWN extent: a single uniform scale crammed every mark into the top
    // fifth of the box on the real ~156,000 px-wide canvas.
    assert.deepEqual(fitMinimapScale(1000, 500, 100, 100), { xPerContentPx: 0.1, yPerContentPx: 0.2 });
    assert.deepEqual(fitMinimapScale(500, 1000, 100, 100), { xPerContentPx: 0.2, yPerContentPx: 0.1 });
    // An unrendered page reports every extent as 0; both scales must be numbers, not Infinity.
    assert.deepEqual(fitMinimapScale(0, 0, 100, 50), { xPerContentPx: 100, yPerContentPx: 50 });
});

test("test_minimap_draws_one_scaled_mark_per_widget", () => {
    openMappedPage();
    drawLayer1Minimap();
    const marks = [...document.querySelectorAll(".mm-box")] as HTMLElement[];
    assert.equal(marks.length, 2);
    // The two axes scale independently, so 100,50 becomes 10,10 and 168x40 becomes 16.8x8.
    assert.deepEqual(readPlacement(marks[0]!), ["10px", "10px", "16.8px", "8px"]);
    assert.equal(marks[1]!.className, "mm-box bucket");
    // The 1.5 px minimum is applied PER AXIS, so it floors the width only.
    assert.deepEqual(readPlacement(marks[1]!), ["60px", "20px", "1.5px", "2px"]);
    // The viewport rectangle must be the LAST child so it paints over the marks.
    assert.equal(findRequiredElement(".mm-plot").lastElementChild?.id, "mm-view");
});

test("test_minimap_viewport_rectangle_follows_the_pane_scroll", () => {
    // The rectangle must track a scroll WITHOUT a re-render — only it moves, not the marks.
    const pane = openMappedPage();
    drawLayer1Minimap();
    assert.deepEqual(readPlacement(findRequiredElement(".mm-view")), ["0px", "0px", "20px", "20px"]);
    pane.scrollLeft = 300;
    pane.scrollTop = 100;
    pane.dispatchEvent(new window.Event("scroll"));
    // Each offset scaled by its OWN axis: 300 across at 0.1, 100 down at 0.2.
    assert.deepEqual(readPlacement(findRequiredElement(".mm-view")), ["30px", "20px", "20px", "20px"]);
});

test("test_clicking_the_minimap_centres_the_pane_on_that_point", () => {
    // Assert on the REQUEST: happy-dom's scrollTo clamps against its unstubbed, zero content extent.
    const pane = openMappedPage();
    let requested: ScrollToOptions | undefined;
    Object.defineProperty(pane, "scrollTo", {
        configurable: true,
        value: (options: ScrollToOptions) => {
            requested = options;
        },
    });
    drawLayer1Minimap();
    findRequiredElement(".mm-plot").dispatchEvent(
        new window.MouseEvent("click", { clientX: 50, clientY: 20, bubbles: true }),
    );
    // The click is CENTRED and un-scaled per axis; dividing both by the x scale would land at
    // y 150, off the bottom of a 250 px render.
    assert.equal(requested?.left, 400);
    assert.equal(requested?.top, 50);
});
