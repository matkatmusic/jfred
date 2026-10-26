// Layer 1's node-click centring test against the open drawer; DOM boot lives in ./webapp-dom-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { DISK_FILE_CONTENT, buildDiskNodeStage, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

test("test_clicking_a_node_scrolls_it_to_the_centre_of_the_part_the_drawer_leaves_uncovered", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const node = buildDiskNodeStage();
    wireNodeDrawer();
    const pane = getRequiredElementById("timelines");
    pane.scrollTop = 1000;
    pane.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 }) as DOMRect;
    // The drawer overlays the right half only once open; closed it is zero wide.
    getRequiredElementById("drawer").getBoundingClientRect = () => (getRequiredElementById("drawer").classList.contains("open")
        ? { left: 500, right: 1000, top: 0, bottom: 800, width: 500, height: 800 }
        : { left: 1000, right: 1000, top: 0, bottom: 800, width: 0, height: 800 }) as DOMRect;
    node.getBoundingClientRect = () => ({ left: 700, right: 715, top: 100, bottom: 115, width: 15, height: 15 }) as DOMRect;

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    // Uncovered area is x 0..500, y 0..800: centre (250, 400). Node centre (707.5, 107.5).
    assert.equal(pane.scrollLeft, 457.5);
    assert.equal(pane.scrollTop, 1000 - 292.5);
});
