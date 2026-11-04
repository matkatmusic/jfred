import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import {
  clearSandboxMemo,
  getMemoizedSandboxOutcome,
  setSandboxMemoPersistence,
  storeSandboxOutcome,
  writePendingSandboxMemoToDisk,
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

test("test_storeSandboxOutcome_keeps_output_for_a_success_and_a_crash", () => {
  setSandboxMemoPersistence(undefined);
  const success = { stdout: "hi\n", stderr: "", exitCode: 0, timedOut: false };
  const crash = { stdout: "", stderr: "boom\n", exitCode: 3, timedOut: false };
  const timeout = { stdout: "", stderr: "", timedOut: true };
  storeSandboxOutcome("ok", new Map(), success);
  storeSandboxOutcome("crash", undefined, crash);
  storeSandboxOutcome("slow", undefined, timeout);
  assert.deepEqual(getMemoizedSandboxOutcome("ok")?.output, success);
  assert.deepEqual(getMemoizedSandboxOutcome("crash")?.output, crash);
  assert.deepEqual(getMemoizedSandboxOutcome("slow")?.output, timeout);
});

test("test_persisted_round_trip_keeps_output", () => {
  const filePath = new Path(join(mkdtempSync(join(tmpdir(), "reveng-memo-")), "memo.json"));
  setSandboxMemoPersistence(filePath);
  const output = { stdout: "out\n", stderr: "err\n", exitCode: 1, timedOut: false };
  storeSandboxOutcome("round", undefined, output);
  writePendingSandboxMemoToDisk();
  setSandboxMemoPersistence(filePath);
  assert.deepEqual(getMemoizedSandboxOutcome("round"), { post: undefined, output });
  setSandboxMemoPersistence(undefined);
});

test("test_an_old_format_file_loads_with_output_absent", () => {
  const filePath = new Path(join(mkdtempSync(join(tmpdir(), "reveng-memo-")), "old.json"));
  writeFileSync(filePath.toString(), JSON.stringify({ old: { post: { "a.txt": "x" } }, bad: { post: null } }));
  setSandboxMemoPersistence(filePath);
  assert.deepEqual(getMemoizedSandboxOutcome("old"), { post: new Map([["a.txt", "x"]]) });
  assert.equal(getMemoizedSandboxOutcome("old")?.output, undefined);
  assert.equal(getMemoizedSandboxOutcome("bad")?.post, undefined);
  setSandboxMemoPersistence(undefined);
});

test("test_clearSandboxMemo_empties_memory_and_the_file", () => {
  const filePath = new Path(join(mkdtempSync(join(tmpdir(), "reveng-memo-")), "clear.json"));
  setSandboxMemoPersistence(filePath);
  storeSandboxOutcome("gone", new Map([["a.txt", "x"]]));
  writePendingSandboxMemoToDisk();
  assert.ok(existsSync(filePath.toString()));
  clearSandboxMemo();
  assert.equal(getMemoizedSandboxOutcome("gone"), undefined);
  assert.equal(existsSync(filePath.toString()), false);
  setSandboxMemoPersistence(undefined);
});

test("test_clearSandboxMemo_resets_the_batch_counter", () => {
  const filePath = new Path(join(mkdtempSync(join(tmpdir(), "reveng-memo-")), "batch.json"));
  setSandboxMemoPersistence(filePath);
  for (let index = 0; index < 63; index += 1) {
    storeSandboxOutcome(`pre-${index}`, undefined);
  }
  clearSandboxMemo();
  storeSandboxOutcome("after", undefined);
  assert.equal(existsSync(filePath.toString()), false);
  setSandboxMemoPersistence(undefined);
});
