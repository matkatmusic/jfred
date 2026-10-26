import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeScriptRunFileChanges } from "../src/reconstruction_script_run_changes.ts";

test("summarizeScriptRunFileChanges returns no runs for no records", () => {
  assert.deepEqual(summarizeScriptRunFileChanges([], undefined), []);
});
