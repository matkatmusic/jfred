// receiveCdpMessage matches replies to calls; openCdpSession needs live Chrome, so the visual loop covers it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { receiveCdpMessage, type PendingCall } from "../scripts/visual/cdp-session.ts";

function createPendingCall(settled: unknown[]): PendingCall {
  function recordResult(result: Record<string, unknown>): void {
    settled.push(result);
  }
  function recordError(error: Error): void {
    settled.push(error);
  }
  return { resolve: recordResult, reject: recordError };
}

test("receiveCdpMessage resolves the waiting call with the result and removes it", () => {
  const settled: unknown[] = [];
  const pending = new Map<number, PendingCall>([[1, createPendingCall(settled)]]);
  receiveCdpMessage(pending, JSON.stringify({ id: 1, result: { value: 7 } }));
  assert.deepEqual(settled, [{ value: 7 }]);
  assert.equal(pending.size, 0);
});

test("receiveCdpMessage resolves an empty object when the reply has no result", () => {
  const settled: unknown[] = [];
  const pending = new Map<number, PendingCall>([[2, createPendingCall(settled)]]);
  receiveCdpMessage(pending, JSON.stringify({ id: 2 }));
  assert.deepEqual(settled, [{}]);
});

test("receiveCdpMessage rejects the waiting call with the error message", () => {
  const settled: unknown[] = [];
  const pending = new Map<number, PendingCall>([[3, createPendingCall(settled)]]);
  receiveCdpMessage(pending, JSON.stringify({ id: 3, error: { message: "boom" } }));
  assert.equal((settled[0] as Error).message, "boom");
});

test("receiveCdpMessage ignores events and unknown ids", () => {
  const settled: unknown[] = [];
  const pending = new Map<number, PendingCall>([[4, createPendingCall(settled)]]);
  receiveCdpMessage(pending, JSON.stringify({ method: "Page.loadEventFired" }));
  receiveCdpMessage(pending, JSON.stringify({ id: 99, result: {} }));
  assert.deepEqual(settled, []);
  assert.equal(pending.size, 1);
});
