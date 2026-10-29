import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listStepFolders, parseStepNumber, readStepStateFiles } from "../scripts/step_state_files.ts";

const root = mkdtempSync(join(tmpdir(), "step-state-files-test-"));

after(() => rmSync(root, { recursive: true, force: true }));

test("parseStepNumber reads the number after the step- prefix", () => {
  assert.equal(parseStepNumber("step-012"), 12);
});

test("listStepFolders returns only step- folders in numeric order", () => {
  for (const name of ["step-010", "step-002", "other", "step-001"]) {
    mkdirSync(join(root, name));
  }
  assert.deepEqual(listStepFolders(root), ["step-001", "step-002", "step-010"]);
});

test("readStepStateFiles keys by relative path and skips non-source names", () => {
  const stepDir = join(root, "step-002");
  mkdirSync(join(stepDir, "tests"));
  mkdirSync(join(stepDir, "__pycache__"));
  writeFileSync(join(stepDir, "a.py"), "a\n");
  writeFileSync(join(stepDir, "tests", "t.py"), "t\n");
  writeFileSync(join(stepDir, "manifest.json"), "{}");
  writeFileSync(join(stepDir, "__pycache__", "a.pyc"), "x");
  const files = readStepStateFiles(stepDir);
  assert.deepEqual([...files.keys()].sort(), ["a.py", join("tests", "t.py")]);
  assert.equal(files.get("a.py"), "a\n");
});
