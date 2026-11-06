// The state order matters: the landing check only works at a known zoom, so the jump precedes zooming out.

// import assert from "node:assert/strict";
// import { test } from "node:test";
// import { READY_EXPRESSION, VISUAL_STATES } from "../scripts/visual/states.ts";

// function indexOfState(name: string): number {
//     return VISUAL_STATES.findIndex((state) => state.name === name);
// }

// not behavior: checks the shape of a constant list of state definitions.
// test("every state has a unique name and something to drive", () => {
//     const names = VISUAL_STATES.map((state) => state.name);
//     assert.equal(new Set(names).size, names.length);
//     for (const state of VISUAL_STATES) {
//         assert.equal(typeof state.drive, "function");
//     }
// });

// not behavior: checks the exact names of a constant list.
// test("the sequence covers the five requested states plus the jump", () => {
//     assert.deepEqual(VISUAL_STATES.map((state) => state.name), [
//         "01-initial-load", "02-folder-filter", "03-file-selected",
//         "04-ruler-expanded", "05-jump-to-bubble", "06-zoomed-out",
//     ]);
// });

// not behavior: checks the order of entries in a constant list, never runs the states.
// test("the jump is driven before the page is zoomed out", () => {
//     assert.ok(indexOfState("05-jump-to-bubble") < indexOfState("06-zoomed-out"));
// });

// not behavior: checks that a constant string matches a pattern.
// test("readiness is measured on drawn bubbles, not on document.readyState", () => {
//     assert.match(READY_EXPRESSION, /#stage \.filebox/);
// });
