import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMemoizedSandboxOutcome,
  setSandboxMemoPersistence,
  storeSandboxOutcome,
} from "../src/reconstruction_script_sandbox_memo.ts";

test("test_storeSandboxOutcome_then_getMemoizedSandboxOutcome_returns_same_post", () => {
  setSandboxMemoPersistence(undefined);
  const post = new Map([["a.txt", "x"]]);
  storeSandboxOutcome("key-1", post);
  assert.equal(getMemoizedSandboxOutcome("key-1")?.post, post);
});

test("test_getMemoizedSandboxOutcome_is_undefined_for_unknown_key_and_after_clear", () => {
  setSandboxMemoPersistence(undefined);
  assert.equal(getMemoizedSandboxOutcome("missing"), undefined);
  storeSandboxOutcome("key-2", undefined);
  assert.deepEqual(getMemoizedSandboxOutcome("key-2"), { post: undefined });
  setSandboxMemoPersistence(undefined);
  assert.equal(getMemoizedSandboxOutcome("key-2"), undefined);
});
