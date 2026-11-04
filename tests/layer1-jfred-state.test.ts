// Per-file test for webapp/layer1-jfred-state.ts: load, commit, delete and tip reads of the module state.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  commitPending,
  deleteJfredBranch,
  loadJfredBranch,
  readJfredBranch,
  readTipMs,
  setArmed,
  setBase,
  setPending,
} from "../webapp/layer1-jfred-state.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const BASE = { instant: "2026-06-01T09:00:00Z", shortHash: "a1b2c3d4" };
const FIRST = { instant: "2026-06-01T09:05:00Z", shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" };
const SECOND = { instant: "2026-06-03T10:30:00Z", shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "two" };
const EMPTY_VIEW: WireLayer1View = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW: WireLayer1View = { ...EMPTY_VIEW, jfredCommits: { base: BASE, commits: [FIRST, SECOND] } };

beforeEach(() => {
  loadJfredBranch(EMPTY_VIEW);
  setArmed(false);
});

test("test_load_reads_base_and_commits_from_the_view", () => {
  // Verify: the module state copies the wire field.
  loadJfredBranch(CANNED_VIEW);
  const branch = readJfredBranch();
  assert.deepEqual(branch.base, BASE);
  assert.deepEqual(branch.commits, [FIRST, SECOND]);
  assert.equal(branch.pending, undefined);
});

test("test_load_from_a_view_without_the_field_empties_everything", () => {
  // Verify: a real-data view leaves no base, no commits, no pending mark.
  loadJfredBranch(CANNED_VIEW);
  setPending({ instant: "2026-06-03T18:20:00Z", message: "draft" });
  loadJfredBranch(EMPTY_VIEW);
  const branch = readJfredBranch();
  assert.equal(branch.base, undefined);
  assert.deepEqual(branch.commits, []);
  assert.equal(branch.pending, undefined);
});

test("test_a_second_load_replaces_the_first", () => {
  // Verify: no entries from the first load survive.
  loadJfredBranch(CANNED_VIEW);
  loadJfredBranch({ ...EMPTY_VIEW, jfredCommits: { base: BASE, commits: [FIRST] } });
  assert.deepEqual(readJfredBranch().commits, [FIRST]);
});

test("test_load_keeps_the_armed_flag", () => {
  // Verify: a redraw load must not switch commit mode off.
  setArmed(true);
  loadJfredBranch(EMPTY_VIEW);
  assert.equal(readJfredBranch().isArmed, true);
});

test("test_commit_uses_count_plus_one_and_the_tip_as_parent", () => {
  // Verify: hash c0ffee03, parent commit 2, draft unchanged, pending cleared.
  loadJfredBranch(CANNED_VIEW);
  setPending({ instant: "2026-06-03T18:20:00Z", message: "draft" });
  const made = commitPending();
  assert.deepEqual(made, { instant: "2026-06-03T18:20:00Z", shortHash: "c0ffee03", parentShortHash: "c0ffee02", message: "draft" });
  assert.equal(readJfredBranch().commits.length, 3);
  assert.equal(readJfredBranch().pending, undefined);
});

test("test_first_commit_has_the_base_as_parent", () => {
  // Verify: with no commits yet, the tip is the base.
  setBase(BASE);
  setPending({ instant: "2026-06-01T09:05:00Z", message: "draft" });
  assert.equal(commitPending().parentShortHash, "a1b2c3d4");
  assert.equal(readJfredBranch().commits[0]?.shortHash, "c0ffee01");
});

test("test_commit_without_a_pending_mark_throws", () => {
  // Verify: no fallback; a missing draft is loud.
  loadJfredBranch(CANNED_VIEW);
  assert.throws(() => commitPending());
});

test("test_delete_clears_everything_and_keeps_armed", () => {
  // Verify: base, commits and pending go; the mode flag stays.
  loadJfredBranch(CANNED_VIEW);
  setArmed(true);
  setPending({ instant: "2026-06-03T18:20:00Z", message: "draft" });
  deleteJfredBranch();
  const branch = readJfredBranch();
  assert.equal(branch.base, undefined);
  assert.deepEqual(branch.commits, []);
  assert.equal(branch.pending, undefined);
  assert.equal(branch.isArmed, true);
});

test("test_tip_is_the_last_commit_else_the_base_else_undefined", () => {
  // Verify: readTipMs follows the growing prefix.
  assert.equal(readTipMs(), undefined);
  setBase(BASE);
  assert.equal(readTipMs(), Date.parse(BASE.instant));
  loadJfredBranch(CANNED_VIEW);
  assert.equal(readTipMs(), Date.parse(SECOND.instant));
});
