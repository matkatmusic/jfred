// The scroll area keeps room below the last bubble so it can scroll clear of the minimap, in every mode.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// Same order as layer1-styles.css: canvas.css first, minimap.css later, so the cascade matches the page.
function loadCanvasAndMinimapStyles(): void {
    for (const sheet of ["bubbles/canvas.css", "minimap/minimap.css"]) {
        const style = document.createElement("style");
        style.textContent = readFileSync(new URL(`../webapp/layer1-components/${sheet}`, import.meta.url), "utf8");
        document.head.append(style);
    }
}

test("test_scroll_area_without_a_reverse_bubble_has_room_below_for_the_minimap", () => {
    // Load the real canvas and minimap sheets into the test page.
    initLayer1Dom();
    loadCanvasAndMinimapStyles();
    // Add a plain scroll area with no reverse bubble inside.
    const stagewrap = document.createElement("div");
    stagewrap.className = "stagewrap";
    const timelines = document.createElement("main");
    timelines.className = "timelines";
    stagewrap.append(timelines);
    document.body.append(stagewrap);
    // Its bottom padding clears the minimap: height 124px + bottom gap 12px + margin 16px.
    // happy-dom resolves var() but leaves calc() unsolved, so the expected text keeps the calc wrapper.
    assert.equal(window.getComputedStyle(timelines).paddingBottom, "calc(124px + 12px + 16px + 0px)");
});
