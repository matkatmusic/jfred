// Test for webapp/layer1-wire-jfred.ts: commit column wire types and the optional view field.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WireJfredCommitsOf } from "../webapp/layer1-wire-jfred.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

test("test_wire_jfred_module_loads", async () => {
  // Verify: the module exists and holds only types, so nothing is exported at run time.
  const loaded = await import("../webapp/layer1-wire-jfred.ts");
  assert.deepEqual(Object.keys(loaded), []);
});

test("test_wire_jfred_commits_accept_a_base_and_commits", () => {
  // Verify: each commit's parent is the base or the commit before it.
  const base = { instant: "2026-06-01T09:00:00Z", shortHash: "a1b2c3d4" };
  const first = { instant: "2026-06-01T09:05:00Z", shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" };
  const second = { instant: "2026-06-03T10:30:00Z", shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "two" };
  const jfredCommits: WireJfredCommitsOf<string> = { base, commits: [first, second] };
  assert.equal(first.parentShortHash, jfredCommits.base.shortHash);
  assert.equal(second.parentShortHash, first.shortHash);
});

test("test_wire_view_type_checks_with_and_without_jfred_commits", () => {
  // Verify: a view is valid with the field and without it.
  const without: WireLayer1View = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
  const withField: WireLayer1View = { ...without, jfredCommits: { base: { instant: "2026-06-01T09:00:00Z", shortHash: "a1b2c3d4" }, commits: [] } };
  assert.equal(without.jfredCommits, undefined);
  assert.equal(withField.jfredCommits?.commits.length, 0);
});
