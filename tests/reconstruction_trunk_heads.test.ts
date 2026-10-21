// Tests for the head-chain helpers used by reconstruction_trunk.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterUniqueUuids, isChainOverlapping, isMaximalTip } from "../src/reconstruction_trunk_heads.ts";
import { Uuid } from "../src/structures/domain.ts";

test("filterUniqueUuids keeps first-seen order and drops repeats", () => {
  const unique = filterUniqueUuids([new Uuid("b"), new Uuid("a"), new Uuid("b")]);
  assert.deepEqual(unique.map((uuid) => uuid.toString()), ["b", "a"]);
});

test("isChainOverlapping is true only when chains share a uuid", () => {
  assert.equal(isChainOverlapping(new Set(["a", "b"]), new Set(["b", "c"])), true);
  assert.equal(isChainOverlapping(new Set(["a"]), new Set(["c"])), false);
});

test("isMaximalTip is false for a head that lies on another head's chain", () => {
  const shallow = new Uuid("a");
  const deep = new Uuid("b");
  const chains = new Map([["a", new Set(["a"])], ["b", new Set(["a", "b"])]]);
  assert.equal(isMaximalTip(shallow, [shallow, deep], chains), false);
  assert.equal(isMaximalTip(deep, [shallow, deep], chains), true);
});
