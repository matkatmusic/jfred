import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/viewer_api_layer2_fixture_data.ts";
import { listHunkProblems } from "../src/viewer_api_fixture_hunk_problems.ts";
import { EDITS, type FixtureEvent } from "../src/viewer_api_layer3_fixture_data.ts";

const CRAFTED_EDIT = EDITS[1]!;

function buildEvent(hunks: FixtureEvent["hunks"]): FixtureEvent {
  return { ...CRAFTED_EDIT, hunks };
}

test("a clean crafted edit has no hunk problems", () => {
  assert.deepEqual(listHunkProblems("w", CRAFTED_EDIT), []);
});

test("an edit with no hunks is reported", () => {
  assert.deepEqual(listHunkProblems("w", buildEvent([])), ["w: an edit has no hunks"]);
  assert.deepEqual(listHunkProblems("w", buildEvent(undefined)), ["w: an edit has no hunks"]);
});

test("wrong counts, wrong starts and unprefixed rows are each reported", () => {
  const hunk = { oldStart: 0, oldLines: 5, newStart: 0, newLines: 5, lines: [" a", "-b", "+c", "d"] };
  const problems = listHunkProblems("w", buildEvent([hunk]));
  assert.equal(problems.length, 3);
  assert.match(problems[0]!, /hunk counts 5\/5 disagree with its rows 2\/2/);
  assert.match(problems[1]!, /hunk starts at line 0\/0/);
  assert.match(problems[2]!, /1 hunk rows have no/);
});
