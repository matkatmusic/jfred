import assert from "node:assert/strict";
import { test } from "node:test";
import { collectScriptRunFileChanges } from "../src/reconstruction_script_run_changes.ts";

test("collectScriptRunFileChanges returns no runs for no records", () => {
  assert.deepEqual(collectScriptRunFileChanges([], undefined), []);
});
