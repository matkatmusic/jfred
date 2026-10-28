// The pass/fail judgement of the first-node scroll probe, tested without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isBroughtOnScreen, isSetupValid } from "../scripts/visual/layer4-first-node-checks.ts";

test("setup is valid only with a visible node that starts off screen", () => {
  assert.equal(isSetupValid({ visibleCount: 1, onScreenBefore: false }), true);
  assert.equal(isSetupValid({ visibleCount: 1, onScreenBefore: true }), false);
  assert.equal(isSetupValid({ visibleCount: 0 }), false);
});

test("the node counts as brought on screen only when the probe says true", () => {
  assert.equal(isBroughtOnScreen({ visibleCount: 1, onScreenAfter: true }), true);
  assert.equal(isBroughtOnScreen({ visibleCount: 1, onScreenAfter: false }), false);
  assert.equal(isBroughtOnScreen({ visibleCount: 1 }), false);
});
