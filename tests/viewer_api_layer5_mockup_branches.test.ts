// Tests src/viewer_api_layer5_mockup_branches.ts: canned fixture lanes and branch file content.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtureBranchesPayload, readFixtureBranchFile } from "../src/viewer_api_layer5_mockup_branches.ts";
import { WireEditSide } from "../webapp/layer1-wire-edits.ts";

test("buildFixtureBranchesPayload lists three lanes over two paths and writes two progress lines", () => {
  const lines: unknown[] = [];
  const view = buildFixtureBranchesPayload((value) => lines.push(value));
  assert.equal(lines.length, 2);
  assert.deepEqual(view.pairs.map((pair) => pair.path.toString()), ["src/util.ts", "src/index.ts"]);
  assert.deepEqual(view.pairs.map((pair) => pair.branches.length), [1, 2]);
});

test("buildFixtureBranchesPayload numbers change ids by path, lane and node", () => {
  const view = buildFixtureBranchesPayload(() => {});
  const lane = view.pairs[1]?.branches[1];
  assert.equal(lane?.nodes[1]?.changeId.toString(), "toolu_fixture_branch_1_1_1");
  assert.equal(lane?.rejoinAt, undefined);
  assert.equal(view.pairs[1]?.branches[0]?.rejoinAt?.toISOString(), "2026-06-03T18:20:00.000Z");
});

test("readFixtureBranchFile adds one line naming the change on the non-base side", () => {
  const base = readFixtureBranchFile("src/util.ts", "toolu_x", WireEditSide.base).content;
  const after = readFixtureBranchFile("src/util.ts", "toolu_x", "after").content;
  assert.equal(after, `${base}\n// toolu_x`);
});
