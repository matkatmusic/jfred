// The pure diff step of the computed-style proof: same captures give no difference, one changed value gives exactly one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { listStyleDifferences, type StyleCapture } from "../scripts/visual/computed-style-diff.ts";

function buildCapture(colorOfButton: string): StyleCapture {
  return {
    properties: ["color", "display"],
    values: ["red", "block", colorOfButton, "inline"],
    styles: [[0, 0, 1, 1], [0, 2, 1, 3]],
    paths: ["html[0] > body[1]", "html[0] > body[1] > button#go.pill[0]"],
    states: { "fixture/first-load": { 0: 0, 1: 1 } },
  };
}

test("two equal captures have no difference", () => {
  assert.deepEqual(listStyleDifferences(buildCapture("blue"), buildCapture("blue")), []);
});

test("one changed value is reported with state, path, property, before and after", () => {
  const differences = listStyleDifferences(buildCapture("blue"), buildCapture("green"));
  assert.deepEqual(differences, [{
    state: "fixture/first-load", path: "html[0] > body[1] > button#go.pill[0]", property: "color", before: "blue", after: "green",
  }]);
});

test("a style row shorter than the property list reads as empty text for the missing property", () => {
  const properties = ["color", "display", "--stack"];
  const shortRows: StyleCapture = { ...buildCapture("blue"), properties };
  const paddedRows: StyleCapture = { ...buildCapture("blue"), properties, values: ["red", "block", "blue", "inline", ""], styles: [[0, 0, 1, 1, 2, 4], [0, 2, 1, 3]] };
  assert.deepEqual(listStyleDifferences(shortRows, paddedRows), []);
});

test("a compare limited to a property list ignores changes outside it", () => {
  assert.deepEqual(listStyleDifferences(buildCapture("blue"), buildCapture("green"), ["display"]), []);
  assert.equal(listStyleDifferences(buildCapture("blue"), buildCapture("green"), ["color"]).length, 1);
});

test("a state that only one capture has is reported", () => {
  const withoutStates: StyleCapture = { ...buildCapture("blue"), states: {} };
  const differences = listStyleDifferences(buildCapture("blue"), withoutStates);
  assert.equal(differences.length, 2);
  assert.equal(differences[0]?.property, "<element>");
});
