import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  SESSION_A,
  SESSION_B,
  buildPromptRecord,
  createSourceTree,
  createTwoSourceEditFixture,
  writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

test("createSourceTree makes the projects folder and the file-history sibling", () => {
  const tree = createSourceTree("-demo");
  assert.equal(tree.projectDir, join(tree.treeRoot, "projects", "-demo"));
  assert.equal(existsSync(tree.projectDir), true);
  assert.equal(existsSync(join(tree.treeRoot, "file-history")), true);
});

test("writeTranscriptFixture writes one JSON line per record and loads them back", () => {
  const tree = createSourceTree("-demo");
  const prompt = buildPromptRecord("u1", null, "2026-07-22T10:00:00.000Z", "/work");
  const loaded = writeTranscriptFixture(tree.projectDir, "s.jsonl", [prompt]);
  const text = readFileSync(join(tree.projectDir, "s.jsonl"), "utf8");
  assert.equal(text, JSON.stringify(prompt) + "\n");
  assert.equal(loaded.length, 1);
});

test("buildPromptRecord defaults the session and sets isSidechain only when asked", () => {
  const plain = buildPromptRecord("u1", null, "t", "/work") as Record<string, unknown>;
  assert.equal(plain.sessionId, SESSION_A);
  assert.equal("isSidechain" in plain, false);
  const sidechain = buildPromptRecord("u2", "u1", "t", "/work", { isSidechain: true, sessionId: SESSION_B }) as Record<string, unknown>;
  assert.equal(sidechain.sessionId, SESSION_B);
  assert.equal(sidechain.isSidechain, true);
});

test("createTwoSourceEditFixture builds two sources and appends extra records to A", () => {
  const fixture = createTwoSourceEditFixture("line one\n", ({ rootA }) => [
    buildPromptRecord("extra", null, "2026-07-22T10:01:00.000Z", rootA),
  ]);
  assert.equal(fixture.listA.length, 3);
  assert.equal(fixture.listB.length, 2);
  assert.equal(fixture.sources.length, 2);
  assert.equal(fixture.alphaPath, join(fixture.rootA, "app.py"));
  assert.equal(fixture.betaPath, join(fixture.rootB, "app.py"));
});
