// Per-file test for layer1-run-queue-helpers.ts: the pure builders, the line encoder, and waitUntil.

// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
// import { buildResult, buildRun, buildView, encodeLines, waitUntil } from "./layer1-run-queue-helpers.ts";

// not behavior: it checks the data shape returned by a test-only helper, not product behavior.
// test("test_buildRun_puts_the_minute_in_the_instant_and_the_line", () => {
//   const run = buildRun("early", 5);
//   assert.equal(run.toolUseId, "early");
//   assert.equal(run.instant, "2026-07-01T10:05:00.000Z");
//   assert.equal(run.line, 5);
// });

// not behavior: it checks the data shape returned by a test-only helper, not product behavior.
// test("test_buildView_makes_one_pair_per_path_with_the_first_run_instant_on_disk", () => {
//   const runs = [buildRun("a", 1), buildRun("b", 2)];
//   const view = buildView({ "one.ts": runs, "two.ts": [buildRun("c", 3)] });
//   assert.deepEqual(view.pairs.map((pair) => pair.path), ["one.ts", "two.ts"]);
//   assert.equal(view.pairs[0]!.onDisk!.instant, runs[0]!.instant);
//   assert.deepEqual(view.pairs[0]!.scriptRuns, runs);
// });

// not behavior: it checks the data shape returned by a test-only helper, not product behavior.
// test("test_buildResult_is_a_replayed_result_for_the_id", () => {
//   const result = buildResult("late");
//   assert.equal(result.toolUseId, "late");
//   assert.equal(result.outcome, WireRunOutcome.replayed);
// });

// not behavior: it checks the output text of a test-only helper, not product behavior.
// test("test_encodeLines_writes_one_json_line_per_item", () => {
//   assert.equal(encodeLines([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
// });

// not behavior: it checks a test-only wait helper, not product behavior.
// test("test_waitUntil_returns_once_the_condition_is_true", async () => {
//   let calls = 0;
//   await waitUntil(() => ++calls > 2);
//   assert.ok(calls > 2);
// });
