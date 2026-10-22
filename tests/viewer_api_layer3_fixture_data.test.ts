import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/viewer_api_layer2_fixture_data.ts";
import { applyHunksToLines, checkHunkMatchesBase } from "../src/layer1_edit_hunks.ts";
import {
  EDITS, buildEditEvent, buildReplaceHunk, buildStaleEditEvent, findFixtureEvent, listFixtureEvents,
} from "../src/viewer_api_layer3_fixture_data.ts";

const TEN_LINES = ["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"];
const SPEC = { path: "a.ts", at: "2026-06-01T08:46:00Z", session: "0f3c9a7e.jsonl", line: 1 };

const listCrafted = () => EDITS.filter((event) => !event.session.startsWith("bulk-"));

test("a replace hunk keeps three context lines each side and counts them", () => {
  const hunk = buildReplaceHunk(TEN_LINES, 5, "new5");
  assert.deepEqual(hunk, {
    oldStart: 3, oldLines: 7, newStart: 3, newLines: 7,
    lines: [" l2", " l3", " l4", "-l5", "+new5", " l6", " l7", " l8"],
  });
});

test("a replace hunk near the top is clamped to the first line", () => {
  const hunk = buildReplaceHunk(TEN_LINES, 0, "new0");
  assert.equal(hunk.oldStart, 1);
  assert.equal(hunk.oldLines, 4);
  assert.equal(hunk.newLines, 4);
});

test("matchesBase is true for the base the hunk was cut from and false for another", () => {
  const hunk = buildReplaceHunk(TEN_LINES, 5, "new5");
  assert.equal(checkHunkMatchesBase(TEN_LINES, hunk), true);
  assert.equal(checkHunkMatchesBase(TEN_LINES.map((line) => (line === "l6" ? "other" : line)), hunk), false);
});

test("applyHunkLines swaps the removed line for the added one", () => {
  const hunk = buildReplaceHunk(TEN_LINES, 5, "new5");
  assert.deepEqual(applyHunksToLines(TEN_LINES, [hunk]), ["l0", "l1", "l2", "l3", "l4", "new5", "l6", "l7", "l8", "l9"]);
});

test("a stale edit event is cut against a different base and expects the derived state", () => {
  const stale = buildStaleEditEvent(SPEC, TEN_LINES, 5);
  assert.equal(stale.expectDerived, true);
  assert.equal(checkHunkMatchesBase(TEN_LINES, stale.hunks![0]!), false);
  assert.equal(buildEditEvent(SPEC, TEN_LINES, 5).expectDerived, undefined);
});

test("the crafted set holds twelve events across the three sessions that have disk-paired files", () => {
  const crafted = listCrafted();
  assert.equal(crafted.length, 12);
  assert.deepEqual([...new Set(crafted.map((event) => event.session))].sort(),
    ["0f3c9a7e.jsonl", "b21d84c5.jsonl", "d4a06b8f.jsonl"]);
});

test("util.ts, the dispatcher and index.ts each span two or more sessions", () => {
  const sessionsOf = (path: string) => new Set(listCrafted().filter((event) => event.path === path).map((event) => event.session));
  assert.equal(sessionsOf("src/util.ts").size, 2);
  assert.equal(sessionsOf("src/components/interim-run-scenario/test_run_scenario_dispatcher.ts").size, 2);
  assert.equal(sessionsOf("src/index.ts").size, 3);
});

test("exactly one crafted event is the stale edit", () => {
  assert.deepEqual(listCrafted().filter((event) => event.expectDerived === true).map((event) => event.kind), ["edit"]);
});

test("README.md and session 7ce50a19 get no events", () => {
  assert.equal(listFixtureEvents("README.md").length, 0);
  assert.ok(!EDITS.some((event) => event.session === "7ce50a19.jsonl"));
});

test("listFixtureEvents answers oldest first", () => {
  const instants = listFixtureEvents("src/index.ts").map((event) => event.at);
  assert.deepEqual(instants, [...instants].sort());
  assert.equal(instants.length, 5);
});

test("every change id is unique", () => {
  assert.equal(new Set(EDITS.map((event) => event.changeId)).size, EDITS.length);
});

test("findFixtureEvent throws for an unknown id", () => {
  assert.throws(() => findFixtureEvent("toolu_nope"), /no fixture event/);
});
