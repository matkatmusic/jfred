// createTempDir returns a fresh, existing, uniquely named reveng-overrides folder each call.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { describe, it } from "node:test";
import { createTempDir } from "./overrides-test-helpers.ts";

describe("createTempDir", () => {
  it("creates an existing directory with the reveng-overrides prefix", () => {
    const dir = createTempDir();
    assert.ok(existsSync(dir));
    assert.ok(statSync(dir).isDirectory());
    assert.ok(basename(dir).startsWith("reveng-overrides-"));
  });

  it("returns a different directory on each call", () => {
    assert.notEqual(createTempDir(), createTempDir());
  });
});
