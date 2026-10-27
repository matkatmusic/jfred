import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDiff, computeDiffBlockHeader } from "../src/reconstruction_render_diff.ts";
import { createThenDelete } from "./reconstruction_render-test-helpers.ts";

// A delete block lists the removed lines with a "-" prefix under a "deleted" header.
test("test_renderDiff_marks_removed_lines_after_delete_header", () => {
  const out = renderDiff(createThenDelete());
  assert.ok(out.includes("deleted"));
  assert.ok(out.includes("- def hello():"));
  assert.ok(out.includes("+ def hello():"));
});

// The block header labels a first revision as created.
test("test_computeDiffBlockHeader_labels_first_revision_created", () => {
  const header = computeDiffBlockHeader(undefined, createThenDelete()[0]!);
  assert.ok(header.startsWith("@@ created @ "));
});
