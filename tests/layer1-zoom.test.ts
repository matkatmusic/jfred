// The Layer 1 page's zoom control (spec S18 feedback fixes, plan step 5). The real render is 833
// widgets tall and far wider than a screen, so the page ships a zoom rather than asking the user to
// scroll the whole thing at 100%.
//
// happy-dom implements no `zoom` LAYOUT, so every assertion below reads the CUSTOM PROPERTY the page
// publishes on .viz-root — never a measured box, which would be measuring happy-dom rather than the
// page. ZOOM_MINIMUM is imported rather than repeated as a literal: a retuned bound must not leave a
// stale expectation passing here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { ZOOM_MINIMUM } from "../webapp/layer1-zoom.ts";

// webapp/layer1-page.ts calls bootLayer1Page() at MODULE SCOPE, so the first import in this process
// wires the zoom buttons a SECOND time — and one click would then apply two steps. Absorb that boot
// here, against a throwaway DOM.
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// A fresh page, booted once. No endpoint is stubbed and none is needed: wireZoomControls runs before
// any fetch, and the empty query makes loadLayer1View return without one.
function openZoomablePage(): void {
    setupLayer1Dom();
    bootLayer1Page();
}

// The one value the page contributes to zoom layout. It sits on .viz-root rather than on .canvas so
// it is INHERITED — .canvas is only the element that consumes it.
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
    // Scenario (plan step 5): the page opens at 100%, one zoom-out step divides the level by the
    // step while the readout follows, and Reset returns both to their opening values in one click
    // rather than stepping back.
    // Steps:
    // boot the page — wireZoomControls applies 1, so the readout opens populated rather than blank.
    openZoomablePage();
    assert.equal(readPublishedZoom(), "1");
    assert.equal(readZoomLevelText(), "100%");
    // one zoom-out step divides by the 1.25 step, reported rounded to a whole percent.
    clickButtonById("zoom-out");
    assert.equal(readPublishedZoom(), String(1 / 1.25));
    assert.equal(readZoomLevelText(), "80%");
    // Reset goes straight back to the opening level.
    clickButtonById("zoom-reset");
    assert.equal(readPublishedZoom(), "1");
    assert.equal(readZoomLevelText(), "100%");
});

test("test_zoom_out_clamps_at_the_minimum", () => {
    // Scenario (plan step 5): the step is MULTIPLICATIVE, so nothing stops it short of zero on its
    // own — the clamp is the only thing keeping a held-down button from shrinking the render away.
    // Steps:
    // boot the page and click zoom-out far past the bound.
    openZoomablePage();
    for (let click = 0; click < 30; click++) {
        clickButtonById("zoom-out");
    }
    // the level rests exactly ON the bound, never below it.
    assert.equal(readPublishedZoom(), String(ZOOM_MINIMUM));
    assert.equal(readZoomLevelText(), "10%");
});
