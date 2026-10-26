// Task 329/356: the DiffView step ladder: markers, order, a string-loading source per revision, and the run bracket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunBracket, listDiffableSteps } from "../webapp/layer1-drawer-steps.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";

const VIEW: WireLayer1View = {
  pairs: [{
    path: "src/a.ts",
    commits: [{ hash: "aaaaaaaabbbbbbbb", instant: T0, axisPx: 0 }, { hash: "ccccccccdddddddd", instant: T1, axisPx: 22 }],
    onDisk: { instant: T2, axisPx: 44 },
    snapshots: [{ version: 1, sessionId: "s", sessionFile: "s.jsonl", instant: T1, axisPx: 22 }],
  }],
  gitOrphans: [{ path: "src/gone.ts", instant: T1, axisPx: 22 }],
  diskOrphans: [{ path: "notes.txt", instant: T0, axisPx: 0 }],
  ruler: [],
};

test("a pair's steps are chronological: commits, its snapshot, then on disk", () => {
  const steps = listDiffableSteps(VIEW, "src/a.ts");
  assert.deepEqual(steps.map((step) => step.marker), ["aaaaaaaa", "cccccccc", "@v1 📸", "on disk"]);
});

test("every step can load its state as a string", () => {
  for (const step of listDiffableSteps(VIEW, "src/a.ts")) {
    assert.equal(typeof step.loadContent, "function", step.marker);
  }
});

test("a disk orphan has exactly one on-disk step", () => {
  assert.deepEqual(listDiffableSteps(VIEW, "notes.txt").map((step) => step.marker), ["on disk"]);
});

test("a git orphan (deleted file) has no diffable steps", () => {
  assert.deepEqual(listDiffableSteps(VIEW, "src/gone.ts"), []);
});

test("an unknown path has no diffable steps", () => {
  assert.deepEqual(listDiffableSteps(VIEW, "src/never-heard-of-it.ts"), []);
});

test("computeRunBracket brackets between the nearest before and after steps", () => {
  // VIEW's src/a.ts ladder: T0 (commit), T1 (commit+snapshot), T2 (on disk).
  const bracket = computeRunBracket(VIEW, "src/a.ts", "2026-07-01T10:30:00.000Z");
  assert.deepEqual(bracket, { baseIndex: 0, targetIndex: 1 });
});

test("computeRunBracket clamps to the first step when the run precedes every step", () => {
  const bracket = computeRunBracket(VIEW, "src/a.ts", "2026-06-01T00:00:00.000Z");
  assert.deepEqual(bracket, { baseIndex: 0, targetIndex: 0 });
});

test("computeRunBracket clamps to the last step when the run is after every step", () => {
  const bracket = computeRunBracket(VIEW, "src/a.ts", "2026-08-01T00:00:00.000Z");
  const lastIndex = listDiffableSteps(VIEW, "src/a.ts").length - 1;
  assert.deepEqual(bracket, { baseIndex: lastIndex, targetIndex: lastIndex });
});

test("computeRunBracket returns undefined for a path with no diffable steps", () => {
  assert.equal(computeRunBracket(VIEW, "src/never-heard-of-it.ts", T0), undefined);
});
