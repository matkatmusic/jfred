import { test } from "node:test";
import assert from "node:assert/strict";
import { isImpureExecutionAllowed, executeWithImpureExecution,setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
// import { getDerivedCaches } from "../src/reconstruction_corpus.ts";
// import type { TranscriptRecord } from "../src/structures/envelope.ts";

test("impure execution is allowed by default", () => {
  assert.equal(isImpureExecutionAllowed(), true);
});

test("setImpureExecutionAllowed turns the gate off and on", () => {
  setImpureExecutionAllowed(false);
  assert.equal(isImpureExecutionAllowed(), false);
  setImpureExecutionAllowed(true);
  assert.equal(isImpureExecutionAllowed(), true);
});

test("test_executeWithImpureExecution_restores_false_after_a_normal_return", () => {
  setImpureExecutionAllowed(false);
  const result = executeWithImpureExecution(() => isImpureExecutionAllowed());
  assert.equal(result, true);
  assert.equal(isImpureExecutionAllowed(), false);
  setImpureExecutionAllowed(true);
});

test("test_executeWithImpureExecution_restores_true_after_a_throw", () => {
  setImpureExecutionAllowed(true);
  assert.throws(() => executeWithImpureExecution(() => { throw new Error("boom"); }), /boom/);
  assert.equal(isImpureExecutionAllowed(), true);
});

test("test_executeWithImpureExecution_restores_false_after_a_throw", () => {
  setImpureExecutionAllowed(false);
  assert.throws(() => executeWithImpureExecution(() => { throw new Error("boom"); }), /boom/);
  assert.equal(isImpureExecutionAllowed(), false);
  setImpureExecutionAllowed(true);
});

test("test_executeWithImpureExecution_nested_call_restores_the_outer_value", () => {
  setImpureExecutionAllowed(false);
  executeWithImpureExecution(() => {
    executeWithImpureExecution(() => undefined);
    assert.equal(isImpureExecutionAllowed(), true);
  });
  assert.equal(isImpureExecutionAllowed(), false);
  setImpureExecutionAllowed(true);
});

// not behavior: it only checks the impureAllowed stamp and object identity of an internal derived-cache object.
// test("test_executeWithImpureExecution_derived_caches_are_stamped_differently_inside_and_outside", () => {
//   setImpureExecutionAllowed(false);
//   const records: TranscriptRecord[] = [];
//   const outside = getDerivedCaches(records, undefined);
//   const inside = executeWithImpureExecution(() => getDerivedCaches(records, undefined));
//   const after = getDerivedCaches(records, undefined);
//   assert.equal(outside.impureAllowed, false);
//   assert.equal(inside.impureAllowed, true);
//   assert.equal(after.impureAllowed, false);
//   assert.notEqual(inside, after);
//   setImpureExecutionAllowed(true);
// });
