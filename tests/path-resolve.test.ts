import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { normalizeAgainstCwd } from "../src/structures/path-resolve.ts";

test("normalizeAgainstCwd joins a relative path onto the cwd", () => {
  assert.equal(normalizeAgainstCwd(new Path("/work/dir"), new Path("a.py")), "/work/dir/a.py");
});

test("normalizeAgainstCwd keeps an absolute path unchanged", () => {
  assert.equal(normalizeAgainstCwd(new Path("/work/dir"), new Path("/abs/a.py")), "/abs/a.py");
});

test("normalizeAgainstCwd returns the path as given when cwd is undefined", () => {
  assert.equal(normalizeAgainstCwd(undefined, new Path("a.py")), "a.py");
});
