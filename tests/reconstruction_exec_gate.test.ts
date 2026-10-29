import { test } from "node:test";
import assert from "node:assert/strict";
import { isImpureExecutionAllowed, setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";

test("impure execution is allowed by default", () => {
  assert.equal(isImpureExecutionAllowed(), true);
});

test("setImpureExecutionAllowed turns the gate off and on", () => {
  setImpureExecutionAllowed(false);
  assert.equal(isImpureExecutionAllowed(), false);
  setImpureExecutionAllowed(true);
  assert.equal(isImpureExecutionAllowed(), true);
});
