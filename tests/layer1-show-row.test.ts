// Task 385: the Layer 8 show row mockup renders one checkbox per node kind present in the loaded view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
setupLayer1Dom();
const { bootLayer1Page, renderLayer1View } = await import("../webapp/layer1-page.ts");

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };

function renderViewAndListShownKinds(pair: object | undefined): string[] {
    setupLayer1Dom();
    bootLayer1Page();
    renderLayer1View({ pairs: pair === undefined ? [] : [pair], gitOrphans: [], diskOrphans: [], ruler: [] } as never);
    return [...document.querySelectorAll<HTMLInputElement>("#show-row input[type=checkbox]")]
        .map((box) => box.dataset["kind"]!);
}

test("test_the_show_row_lists_a_checkbox_for_each_kind_the_view_draws", () => {
    // Scenario: four node kinds in the pair give four boxes, and no script-run box.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, created: INSTANT, snapshots: [SNAPSHOT] };
    assert.deepEqual(renderViewAndListShownKinds(pair), ["created", "commit", "disk", "snapshot"]);
});

test("test_the_show_row_omits_kinds_the_view_does_not_draw", () => {
    // Scenario: a commit-and-disk pair shows no created-at and no snapshot box.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT };
    assert.deepEqual(renderViewAndListShownKinds(pair), ["commit", "disk"]);
});

test("test_the_show_row_boxes_start_checked_and_the_legend_is_gone", () => {
    // Scenario: every box starts checked; the static legend no longer renders.
    renderViewAndListShownKinds({ path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT });
    const boxes = [...document.querySelectorAll<HTMLInputElement>("#show-row input")];
    assert.ok(boxes.every((box) => box.checked));
    assert.equal(document.querySelector(".legend"), null);
});
