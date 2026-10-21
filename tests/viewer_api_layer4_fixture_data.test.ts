import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_RUNS, findFixtureScriptRun } from "../src/viewer_api_layer4_fixture_data.ts";

test("findFixtureScriptRun returns each run and throws on an unknown id", () => {
  for (const run of SCRIPT_RUNS) {
    assert.equal(findFixtureScriptRun(run.toolUseId), run);
  }
  assert.throws(() => findFixtureScriptRun("toolu_missing"));
});
