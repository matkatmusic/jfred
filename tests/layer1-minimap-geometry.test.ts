// Minimap geometry: the per-axis scale and plot placement are pure, so no page is needed beyond a bare element.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { applyBoxToPlot, computeMinimapScale } from "../webapp/layer1-minimap-geometry.ts";

test("test_minimap_scale_fits_each_axis_to_its_own_extent", () => {
    // Each axis scales to its own extent; a uniform scale crammed marks into the canvas's top fifth.
    assert.deepEqual(computeMinimapScale(1000, 500, 100, 100), { xPerContentPx: 0.1, yPerContentPx: 0.2 });
    assert.deepEqual(computeMinimapScale(500, 1000, 100, 100), { xPerContentPx: 0.2, yPerContentPx: 0.1 });
    // An unrendered page reports every extent as 0; both scales must be numbers, not Infinity.
    assert.deepEqual(computeMinimapScale(0, 0, 100, 50), { xPerContentPx: 100, yPerContentPx: 50 });
});

test("test_minimap_box_is_scaled_per_axis_and_clamped_to_the_minimum_mark", () => {
    initLayer1Dom();
    const target = document.createElement("div");
    applyBoxToPlot(target, { leftPx: 100, topPx: 50, widthPx: 168, heightPx: 1 }, { xPerContentPx: 0.1, yPerContentPx: 0.2 });
    assert.deepEqual(
        [target.style.left, target.style.top, target.style.width, target.style.height],
        ["10px", "10px", "16.8px", "1.5px"],
    );
});
