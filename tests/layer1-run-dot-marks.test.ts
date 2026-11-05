// Per-file test for webapp/layer1-run-dot-marks.ts: one svg mark per run state and per rating.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunMarkMarkup, RunMarkKey } from "../webapp/layer1-run-dot-marks.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();

const EXPECTED_KEYS = [
  "not-run", "running", "replayed", "replay-failed", "not-replayed", "original-failed", "cancelled",
  "verified", "mismatch", "injected-unverified",
];

test("test_RunMarkKey_lists_every_run_state_and_every_rating", () => {
  // Scenario: the key list is the ten marks the user approved.
  assert.deepEqual(Object.values(RunMarkKey).sort(), [...EXPECTED_KEYS].sort());
});

test("test_buildRunMarkMarkup_makes_one_svg_with_the_mark_class_for_each_key", () => {
  // Scenario: every key gives one svg element that carries run-mark and its own mark-<key> class.
  for (const key of Object.values(RunMarkKey)) {
    const host = document.createElement("i");
    host.insertAdjacentHTML("beforeend", buildRunMarkMarkup(key));
    const marks = host.querySelectorAll(`svg.run-mark.mark-${key}`);
    assert.equal(marks.length, 1, key);
    assert.equal(host.children.length, 1, key);
  }
});
