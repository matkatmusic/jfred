// Per-file test for tests/layer1-blocked-dot-test-helpers.ts: the dot lands in the canvas with the faked rects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendBlockedDot, buildRect, DEFAULT_DOT, DEFAULT_PANE } from "./layer1-blocked-dot-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("buildRect_computes_right_and_bottom", () => {
  const rect = buildRect(10, 20, 5, 6);
  assert.deepEqual([rect.right, rect.bottom], [15, 26]);
});

test("appendBlockedDot_adds_a_dot_to_the_canvas_with_the_faked_rects", () => {
  initLayer1Dom();
  const dot = appendBlockedDot("toolu_h");
  assert.equal(dot.parentElement!.className, "canvas");
  assert.equal(dot.getBoundingClientRect(), DEFAULT_DOT);
  assert.equal(document.getElementById("timelines")!.getBoundingClientRect(), DEFAULT_PANE);
});
