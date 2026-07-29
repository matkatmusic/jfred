// Task 309: a big stage render paints "drawing the timeline — n/N" between chunks instead of hanging silent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb the first import against a throwaway DOM.
setupLayer1Dom();
const { renderLayer1Stage } = await import("../webapp/layer1-page.ts");
const { LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE } = await import("../webapp/layer1-progress.ts");

const T0 = "2026-07-01T10:00:00.000Z";

// `count` one-commit pairs on a one-entry ruler; enough widgets to force the chunked path when > 100.
function buildViewWithPairs(count: number): object {
    return {
        pairs: Array.from({ length: count }, (_, index) => ({
            path: `src/file${index}.ts`,
            commits: [{ hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", instant: T0, axisPx: 0 }],
            onDisk: { instant: T0, axisPx: 22 },
        })),
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: T0, axisPx: 0, eventCount: count }],
    };
}

test("test_a_multi_chunk_render_paints_a_counted_drawing_label_before_finishing", async () => {
    // Scenario: 150 widgets exceed one chunk, so the first chunk shows a count before the first yield.
    setupLayer1Dom();
    const pending = renderLayer1Stage(buildViewWithPairs(150) as never);
    // Synchronously after the call: chunk one is appended and the loadbar shows its count.
    assert.equal(document.getElementById("loadbar-label")!.textContent,
        `${LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE} — 100 / 150`);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), false);
    assert.equal(document.getElementById("stage")!.childElementCount, 100);
    await pending;
    // Finished: every widget is in the DOM and the loadbar is put away.
    assert.equal(document.getElementById("stage")!.childElementCount, 150);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), true);
});

test("test_a_single_chunk_render_completes_synchronously_without_the_loadbar", () => {
    // Scenario: filter clicks and test fixtures render small views; they must not flash the loadbar.
    setupLayer1Dom();
    void renderLayer1Stage(buildViewWithPairs(3) as never);
    // Synchronously after the call: the whole stage is drawn and the loadbar never appeared.
    assert.equal(document.getElementById("stage")!.childElementCount, 3);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), true);
});
