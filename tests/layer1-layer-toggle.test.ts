// The [2] layer switcher (task 314): a client-side show/hide, read via `data-layer` and `.current`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at module scope, so re-importing it would wire the toggle twice; absorb that boot here first.
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");

// A fresh, once-booted page; the empty query returns before any fetch, so no endpoint stub is needed.
function openPage(): void {
    setupLayer1Dom();
    bootLayer1Page();
}

function vizLayer(): string | undefined {
    return (document.querySelector(".viz-root") as HTMLElement).dataset.layer;
}

function layerButtons(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".layerbar button")];
}

function currentLayerText(): string | null {
    return document.querySelector(".layerbar button.current")!.textContent;
}

function clickLayer(layer: string): void {
    layerButtons().find((button) => button.dataset.layer === layer)!.click();
}

test("test_layer_bar_opens_on_layer_1_with_only_two_buttons", () => {
    // [3] is dropped (unassigned), so exactly two buttons; [2] is live, not dimmed, with the renumbered tooltip.
    openPage();
    const buttons = layerButtons();
    assert.equal(buttons.length, 2);
    assert.equal(vizLayer(), "1");
    assert.equal(currentLayerText(), "1");
    const two = buttons.find((button) => button.dataset.layer === "2")!;
    assert.equal(two.getAttribute("title"), "Layer 2 adds file-history snapshots");
    assert.equal(two.classList.contains("uncomputed"), false);
});

test("test_clicking_layer_2_publishes_data_layer_and_moves_current", () => {
    // The switch is a root attribute the CSS keys on plus a `.current` move — no refetch.
    openPage();
    clickLayer("2");
    assert.equal(vizLayer(), "2");
    assert.equal(currentLayerText(), "2");
});

test("test_toggle_1_2_1_returns_to_layer_1", () => {
    // 1 -> 2 -> 1 lands back on Layer 1, so hiding then showing snapshots is fully reversible.
    openPage();
    clickLayer("2");
    clickLayer("1");
    assert.equal(vizLayer(), "1");
    assert.equal(currentLayerText(), "1");
});
