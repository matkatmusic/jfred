import assert from "node:assert/strict";
import { test } from "node:test";
import { listContentLines } from "../src/viewer_api_layer1_fixture_content.ts";
import { SCRIPT_RUNS, SCRIPT_RUN_NODE_KIND } from "../src/viewer_api_layer4_fixture_data.ts";

test("a scriptRun node returns the canned body, not a per-language template", () => {
  const run = SCRIPT_RUNS[0]!;
  const lines = listContentLines("ignored.py", { kind: SCRIPT_RUN_NODE_KIND, toolUseId: run.toolUseId });
  assert.deepEqual(lines, run.code);
});

test("a commit node stamps its short hash into the template", () => {
  const lines = listContentLines("src/index.ts", { kind: "commit", hash: "a1b2c3d4ffff" });
  assert.ok(lines.includes("// revision a1b2c3d4"));
});
