// not behavior: every test in this file checks a test-helper's fixture shape, not what a person or caller of the product sees.
// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
// import {
//   SHARED_PX,
//   buildSharedInstantView,
//   listShownLeaderOffsets,
// } from "./layer1-leader-visibility-test-helpers.ts";

// not behavior: checks the item counts of a test fixture builder's return value.
// test("test_buildSharedInstantView_has_two_pairs_and_three_ruler_entries", () => {
//   const view = buildSharedInstantView() as { pairs: unknown[]; ruler: unknown[] };
//   assert.equal(view.pairs.length, 2);
//   assert.equal(view.ruler.length, 3);
// });

// not behavior: checks a test-only helper's filtering, not a product function.
// test("test_listShownLeaderOffsets_reads_only_leaders_with_the_shown_class", () => {
//   initLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
//   const leaders = document.getElementById("leaders");
//   assert.ok(leaders, "the page has no #leaders element");
//   for (const isShown of [true, false]) {
//     const leader = document.createElement("div");
//     leader.className = isShown ? "leader shown" : "leader";
//     leader.style.setProperty("--axis-px", String(SHARED_PX));
//     leaders.appendChild(leader);
//   }
//   assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
// });
