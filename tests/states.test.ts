// The state sequence's ordering contracts. Which states exist is a design choice; the ORDER is not — the landing check is only meaningful at a known zoom, so the jump must happen before the page is zoomed out.

import assert from "node:assert/strict";
import { test } from "node:test";
import { READY_EXPRESSION, VISUAL_STATES } from "../scripts/visual/states.ts";

function indexOfState(name: string): number {
    return VISUAL_STATES.findIndex((state) => state.name === name);
}

test("every state has a unique name and something to drive", () => {
    const names = VISUAL_STATES.map((state) => state.name);
    assert.equal(new Set(names).size, names.length);
    for (const state of VISUAL_STATES) {
        assert.equal(typeof state.drive, "function");
    }
});

test("the sequence covers the five requested states plus the jump", () => {
    assert.deepEqual(VISUAL_STATES.map((state) => state.name), [
        "01-initial-load", "02-folder-filter", "03-file-selected",
        "04-ruler-expanded", "05-jump-to-bubble", "06-zoomed-out",
    ]);
});

test("the jump is driven before the page is zoomed out", () => {
    assert.ok(indexOfState("05-jump-to-bubble") < indexOfState("06-zoomed-out"));
});

test("readiness is measured on drawn bubbles, not on document.readyState", () => {
    assert.match(READY_EXPRESSION, /#stage \.filebox/);
});
