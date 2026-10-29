// The pure helpers of the Layer 4 real-data checks, tested without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WireScriptRunsView } from "../webapp/layer1-wire-script-runs.ts";
import {
  buildBubblePathExpression,
  buildConnectorOfRun,
  buildDotsOfRun,
  containsAll,
  containsCountLabel,
  findRunById,
  getFirstCodeLine,
  listRunsOnPaths,
} from "../scripts/visual/layer4-real-helpers.ts";

const PAYLOAD = {
  pairs: [
    { path: "a.py", scriptRuns: [{ toolUseId: "run-1" }, { toolUseId: "run-2" }] },
    { path: "b.py", scriptRuns: [{ toolUseId: "run-3" }] },
  ],
} as unknown as WireScriptRunsView;

test("lists the runs only of the paths on screen, in payload order", () => {
  const runs = listRunsOnPaths(PAYLOAD, new Set(["a.py"]));
  assert.deepEqual(runs.map((run) => run.toolUseId), ["run-1", "run-2"]);
  assert.deepEqual(listRunsOnPaths(PAYLOAD, new Set()), []);
});

test("finds a run by tool use id across all pairs", () => {
  assert.equal(findRunById(PAYLOAD, "run-3")?.toolUseId, "run-3");
  assert.equal(findRunById(PAYLOAD, "missing"), undefined);
});

test("detects a count label of the form n / m", () => {
  assert.equal(containsCountLabel(["loading", "3 / 10"]), true);
  assert.equal(containsCountLabel(["loading", "3/10"]), false);
  assert.equal(containsCountLabel([]), false);
});

test("containsAll is true only when every needle is present", () => {
  assert.equal(containsAll(["a", "b", "c"], ["a", "c"]), true);
  assert.equal(containsAll(["a"], ["a", "c"]), false);
});

test("returns the first line that has text", () => {
  assert.equal(getFirstCodeLine("\n  \n  import os\nx = 1"), "  import os");
  assert.equal(getFirstCodeLine(" \n"), "");
});

test("builds browser expressions with the id quoted", () => {
  assert.ok(buildDotsOfRun("t1").includes(`data-tool-use-id="t1"`));
  assert.ok(buildConnectorOfRun("t1").includes(`.script-connector[data-tool-use-id="t1"]`));
  assert.ok(buildBubblePathExpression("d").startsWith("d.closest('.filebox')"));
});
