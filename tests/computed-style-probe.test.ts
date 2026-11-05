// The merge step of the computed-style capture: equal values, styles and paths are stored once across states.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStyleRows } from "../scripts/visual/computed-style-diff.ts";
import type { PageStyleSnapshot } from "../scripts/visual/computed-style-page-probe.ts";
import { addSnapshotToBuilder, createCaptureBuilder } from "../scripts/visual/computed-style-probe.ts";

const SNAPSHOT: PageStyleSnapshot = {
  properties: ["color"],
  values: ["red", "blue"],
  rows: [[0], [1]],
  elements: [["html[0]", 0], ["html[0] > body[1]", 1]],
};

test("the same snapshot added under two states shares its values, styles and paths", () => {
  const builder = createCaptureBuilder();
  addSnapshotToBuilder(builder, "first", SNAPSHOT);
  addSnapshotToBuilder(builder, "second", SNAPSHOT);
  assert.deepEqual(builder.capture.values, ["red", "blue", ""]);
  assert.equal(builder.capture.styles.length, 2);
  assert.equal(builder.capture.paths.length, 2);
  assert.deepEqual(builder.capture.states["first"], builder.capture.states["second"]);
});

test("a later state with an extra property extends the property list in the first-seen order", () => {
  const builder = createCaptureBuilder();
  addSnapshotToBuilder(builder, "first", SNAPSHOT);
  const withCustom: PageStyleSnapshot = { properties: ["--stack", "color"], values: ["red", "blue", "7"], rows: [[2, 0], [2, 1]], elements: SNAPSHOT.elements };
  addSnapshotToBuilder(builder, "second", withCustom);
  assert.deepEqual(builder.capture.properties, ["color", "--stack"]);
  const secondStyleIndex = builder.capture.states["second"]![0]!;
  const secondRow = buildStyleRows(builder.capture)[secondStyleIndex]!;
  assert.deepEqual([builder.capture.values[secondRow[0]!], builder.capture.values[secondRow[1]!]], ["red", "7"]);
  assert.equal(secondRow.length, 2);
});
