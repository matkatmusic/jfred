import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSnapshotFileText,
  isReproducedBySomeStep,
  renderRepoSnapshot,
  trimTrailingNewline,
} from "../src/reconstruction_step_snapshot.ts";
import type { RepoSnapshot } from "../src/reconstruction_steps.ts";
import { Path } from "../src/structures/domain.ts";

function createSnapshot(): RepoSnapshot {
  return new Map([
    [new Path("/tmp/b/test_a.py"), "wrong"],
    [new Path("/tmp/b/a.py"), "right"],
  ]);
}

test("test_getSnapshotFileText_matches_on_a_path_boundary", () => {
  assert.equal(getSnapshotFileText(createSnapshot(), "a.py"), "right");
});

test("test_getSnapshotFileText_returns_undefined_for_an_absent_file", () => {
  assert.equal(getSnapshotFileText(createSnapshot(), "missing.py"), undefined);
});

test("test_trimTrailingNewline_drops_only_one_trailing_newline", () => {
  assert.equal(trimTrailingNewline("x\n\n"), "x\n");
  assert.equal(trimTrailingNewline("x"), "x");
});

test("test_isReproducedBySomeStep_is_true_when_any_step_matches", () => {
  const steps = [new Map<Path, string>(), createSnapshot()];
  assert.equal(isReproducedBySomeStep(steps, new Map([["a.py", "right\n"]])), true);
});

test("test_isReproducedBySomeStep_is_false_when_no_step_matches", () => {
  assert.equal(isReproducedBySomeStep([createSnapshot()], new Map([["a.py", "other"]])), false);
});

test("test_renderRepoSnapshot_sorts_paths_under_hash_headings", () => {
  const rendered = renderRepoSnapshot(createSnapshot());
  assert.equal(rendered, "### /tmp/b/a.py\nright\n\n### /tmp/b/test_a.py\nwrong");
});
