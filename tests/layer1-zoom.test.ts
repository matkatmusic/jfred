// The zoom control for the tall Layer 1 render; tests read the published CSS var since happy-dom lacks zoom layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { ZOOM_MINIMUM } from "../webapp/layer1-zoom.ts";

// layer1-page.ts boots at module scope, so re-importing it would wire zoom buttons twice; absorb that boot here first.
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// A fresh, once-booted page; no endpoint stub needed since wireZoomControls runs before the empty query's no-op fetch.
function openZoomablePage(): void {
    setupLayer1Dom();
    bootLayer1Page();
}

// The zoom value lives on .viz-root so it inherits down; .canvas only consumes it, never sets it.
function readPublishedZoom(): string {
    return (document.querySelector(".viz-root") as HTMLElement).style.getPropertyValue("--zoom");
}

function readZoomLevelText(): string | null {
    return document.getElementById("zoom-level")!.textContent;
}

function clickButtonById(id: string): void {
    (document.getElementById(id) as HTMLButtonElement).click();
}

test("test_zoom_buttons_scale_the_canvas_and_report_the_level", () => {
    // Zoom-out divides the level by the step; Reset restores both to their opening values in one click.
    openZoomablePage();
    assert.equal(readPublishedZoom(), "1");
    assert.equal(readZoomLevelText(), "100%");
    clickButtonById("zoom-out");
    assert.equal(readPublishedZoom(), String(1 / 1.25));
    assert.equal(readZoomLevelText(), "80%");
    clickButtonById("zoom-reset");
    assert.equal(readPublishedZoom(), "1");
    assert.equal(readZoomLevelText(), "100%");
});

// happy-dom has no zoom layout, so this only asserts the page asks to re-anchor, not a measured position.
function litBubbleWithRecordedScroll(): { options: ScrollIntoViewOptions[] } {
    const bubble = document.createElement("div");
    bubble.className = "filebox found";
    const recorded: ScrollIntoViewOptions[] = [];
    bubble.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
        recorded.push(options as ScrollIntoViewOptions);
    };
    document.getElementById("stage")!.append(bubble);
    return { options: recorded };
}

test("test_zoom_re_anchors_on_the_lit_bubble", () => {
    // Native zoom re-lays-out the canvas but keeps scroll position, so zooming out can scroll a found bubble off-screen.
    openZoomablePage();
    const scrolled = litBubbleWithRecordedScroll();
    clickButtonById("zoom-out");
    assert.deepEqual(scrolled.options, [{ block: "start", inline: "center" }]);
});

test("test_zoom_with_nothing_lit_scrolls_nothing", () => {
    // The selection is the anchor, so a page with nothing lit must not scroll on zoom.
    openZoomablePage();
    clickButtonById("zoom-out");
    assert.equal(document.querySelector(".filebox.found"), null);
});

test("test_zoom_out_clamps_at_the_minimum", () => {
    // The zoom step is multiplicative with no floor, so a clamp stops a held button from shrinking the render away.
    openZoomablePage();
    for (let click = 0; click < 30; click++) {
        clickButtonById("zoom-out");
    }
    assert.equal(readPublishedZoom(), String(ZOOM_MINIMUM));
    assert.equal(readZoomLevelText(), "10%");
});
