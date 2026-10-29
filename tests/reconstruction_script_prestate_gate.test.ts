import { test } from "node:test";
import assert from "node:assert/strict";
import { isEveryImportReadOnlySafe, isEveryOpenCallRead } from "../src/reconstruction_script_prestate_gate.ts";

test("test_isEveryImportReadOnlySafe_accepts_stdlib_roots", () => {
  assert.equal(isEveryImportReadOnlySafe("import os, json.decoder\nfrom collections import Counter\n"), true);
});

test("test_isEveryImportReadOnlySafe_rejects_unknown_roots", () => {
  assert.equal(isEveryImportReadOnlySafe("import shutil\n"), false);
  assert.equal(isEveryImportReadOnlySafe("from subprocess import run\n"), false);
});

test("test_isEveryOpenCallRead_accepts_read_modes", () => {
  assert.equal(isEveryOpenCallRead('open("f.py")\nopen("f.py", "r")\nPath(p).open()\n'), true);
});

test("test_isEveryOpenCallRead_rejects_write_and_unprovable_modes", () => {
  assert.equal(isEveryOpenCallRead('open("f.py", "w")\n'), false);
  assert.equal(isEveryOpenCallRead("open(join(a, b))\n"), false);
  assert.equal(isEveryOpenCallRead("open(p"), false);
});
