// The reverse-walk store remembers one walk per file path and hands back its states by index.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearReverseWalks, readReverseState, readReverseWalk, storeReverseWalk } from "../webapp/layer1-reverse-store.ts";
import { WireReverseKind, type WireReverseWalk } from "../webapp/layer1-wire-reverse.ts";

function buildWalk(path: string, contents: string[]): WireReverseWalk {
  return {
    path,
    states: contents.map((content, index) => ({
      index,
      kind: index === 0 ? WireReverseKind.DiskNow : WireReverseKind.EditUndone,
      content,
    })),
  };
}

beforeEach(() => {
  clearReverseWalks();
});

test("test_readReverseWalk_returns_undefined_for_a_path_never_stored", () => {
  // Step 1: nothing is stored.
  // Step 2: reading a path returns undefined.
  assert.equal(readReverseWalk("src/run.ts"), undefined);
});

test("test_readReverseWalk_returns_the_walk_that_was_stored", () => {
  // Step 1: store a walk for src/run.ts.
  const walk = buildWalk("src/run.ts", ["now", "before"]);
  storeReverseWalk(walk);
  // Step 2: reading src/run.ts returns that walk.
  assert.deepEqual(readReverseWalk("src/run.ts"), walk);
});

test("test_readReverseWalk_keeps_walks_of_other_paths_apart", () => {
  // Step 1: store walks for two paths.
  const runWalk = buildWalk("src/run.ts", ["run now"]);
  const otherWalk = buildWalk("src/other.ts", ["other now"]);
  storeReverseWalk(runWalk);
  storeReverseWalk(otherWalk);
  // Step 2: each path returns its own walk.
  assert.deepEqual(readReverseWalk("src/run.ts"), runWalk);
  assert.deepEqual(readReverseWalk("src/other.ts"), otherWalk);
});

test("test_storeReverseWalk_replaces_an_older_walk_for_the_same_path", () => {
  // Step 1: store a walk for src/run.ts, then store a second walk for the same path.
  storeReverseWalk(buildWalk("src/run.ts", ["old now"]));
  const newerWalk = buildWalk("src/run.ts", ["new now", "new before"]);
  storeReverseWalk(newerWalk);
  // Step 2: reading src/run.ts returns only the second walk.
  assert.deepEqual(readReverseWalk("src/run.ts"), newerWalk);
});

test("test_readReverseState_returns_the_state_with_that_index", () => {
  // Step 1: store a walk with two states.
  storeReverseWalk(buildWalk("src/run.ts", ["now", "before"]));
  // Step 2: index 1 returns the older state.
  assert.equal(readReverseState("src/run.ts", 1)?.content, "before");
});

test("test_readReverseState_returns_undefined_for_an_index_past_the_oldest_state", () => {
  // Step 1: store a walk with two states.
  storeReverseWalk(buildWalk("src/run.ts", ["now", "before"]));
  // Step 2: index 2 returns undefined.
  assert.equal(readReverseState("src/run.ts", 2), undefined);
});

test("test_readReverseState_returns_undefined_for_a_path_never_stored", () => {
  // Step 1: nothing is stored.
  // Step 2: reading a state returns undefined.
  assert.equal(readReverseState("src/run.ts", 0), undefined);
});

test("test_clearReverseWalks_forgets_every_stored_walk", () => {
  // Step 1: store walks for two paths.
  storeReverseWalk(buildWalk("src/run.ts", ["now"]));
  storeReverseWalk(buildWalk("src/other.ts", ["now"]));
  // Step 2: clear the store.
  clearReverseWalks();
  // Step 3: both paths return undefined.
  assert.equal(readReverseWalk("src/run.ts"), undefined);
  assert.equal(readReverseWalk("src/other.ts"), undefined);
});
