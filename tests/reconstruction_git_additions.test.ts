// Pure-addition extraction and re-anchoring of line insertions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAdditions, extractPureAdditions } from "../src/reconstruction_git_additions.ts";

test("extractPureAdditions anchors each inserted line to the base line before it", () => {
  const additions = extractPureAdditions(["a", "b"], ["a", "x", "b", "y"]);
  assert.deepEqual(additions, [{ anchor: "a", line: "x" }, { anchor: "b", line: "y" }]);
});

test("extractPureAdditions returns undefined when a base line changed", () => {
  assert.equal(extractPureAdditions(["a", "b"], ["a", "c"]), undefined);
});

test("extractPureAdditions returns undefined when nothing was added", () => {
  assert.equal(extractPureAdditions(["a"], ["a"]), undefined);
});

test("applyAdditions inserts after the anchor and at the top for an undefined anchor", () => {
  const result = applyAdditions(["a", "b"], [{ anchor: undefined, line: "top" }, { anchor: "a", line: "x" }]);
  assert.deepEqual(result, ["top", "a", "x", "b"]);
});

test("applyAdditions returns undefined when an anchor is missing", () => {
  assert.equal(applyAdditions(["a"], [{ anchor: "zzz", line: "x" }]), undefined);
});
