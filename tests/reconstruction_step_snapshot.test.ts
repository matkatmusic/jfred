import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderRepoSnapshot,
  snapshotFileText,
  someStepReproduces,
  stripTrailingNewline,
} from "../src/reconstruction_step_snapshot.ts";
import type { RepoSnapshot } from "../src/reconstruction_steps.ts";
import { Path } from "../src/structures/domain.ts";

function createSnapshot(): RepoSnapshot {
  return new Map([
    [new Path("/tmp/b/test_a.py"), "wrong"],
    [new Path("/tmp/b/a.py"), "right"],
  ]);
}

test("test_snapshotFileText_matches_on_a_path_boundary", () => {
  assert.equal(snapshotFileText(createSnapshot(), "a.py"), "right");
});

test("test_snapshotFileText_returns_undefined_for_an_absent_file", () => {
  assert.equal(snapshotFileText(createSnapshot(), "missing.py"), undefined);
});

test("test_stripTrailingNewline_drops_only_one_trailing_newline", () => {
  assert.equal(stripTrailingNewline("x\n\n"), "x\n");
  assert.equal(stripTrailingNewline("x"), "x");
});

test("test_someStepReproduces_is_true_when_any_step_matches", () => {
  const steps = [new Map<Path, string>(), createSnapshot()];
  assert.equal(someStepReproduces(steps, new Map([["a.py", "right\n"]])), true);
});

test("test_someStepReproduces_is_false_when_no_step_matches", () => {
  assert.equal(someStepReproduces([createSnapshot()], new Map([["a.py", "other"]])), false);
});

test("test_renderRepoSnapshot_sorts_paths_under_hash_headings", () => {
  const rendered = renderRepoSnapshot(createSnapshot());
  assert.equal(rendered, "### /tmp/b/a.py\nright\n\n### /tmp/b/test_a.py\nwrong");
});
