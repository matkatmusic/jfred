// The guards of the computed-style proof: an empty capture is refused and the counts and lines print as promised.

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCaptureHasContent, countCapture, formatStyleDifference } from "../scripts/visual/computed-style-compare.ts";
import type { StyleCapture } from "../scripts/visual/computed-style-diff.ts";

const TWO_STATE_CAPTURE: StyleCapture = {
  properties: ["color"],
  values: ["red"],
  styles: [[0, 0]],
  paths: ["html[0]", "html[0] > body[1]"],
  states: { first: { 0: 0, 1: 0 }, second: { 0: 0 } },
};

test("countCapture counts states and element entries", () => {
  assert.deepEqual(countCapture(TWO_STATE_CAPTURE), { stateCount: 2, elementCount: 3 });
});

test("a capture with no states is refused", () => {
  const empty: StyleCapture = { ...TWO_STATE_CAPTURE, states: {} };
  assert.throws(() => assertCaptureHasContent(empty, "empty.json"), /holds no states/);
});

test("a state with no elements is refused", () => {
  const hollow: StyleCapture = { ...TWO_STATE_CAPTURE, states: { first: {} } };
  assert.throws(() => assertCaptureHasContent(hollow, "hollow.json"), /state first holds no elements/);
});

test("a difference prints as one tab-separated line", () => {
  const line = formatStyleDifference({ state: "s", path: "p", property: "color", before: "red", after: "blue" });
  assert.equal(line, "s\tp\tcolor\tred\tblue");
});
