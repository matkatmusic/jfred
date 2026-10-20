import assert from "node:assert/strict";
import { test } from "node:test";
import { DISK } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";

test("the fixture view carries every bulk file as a bubble", () => {
  const view = buildFixtureLayer1View();
  const bubbleCount = view.pairs.length + view.gitOrphans.length + view.diskOrphans.length;
  assert.ok(bubbleCount >= 88, `expected the ~88-bubble fixture, got ${bubbleCount}`);
});

test("commit-only paths become git orphans and disk-only paths become disk orphans", () => {
  const view = buildFixtureLayer1View();
  const gitOrphanPaths = view.gitOrphans.map((orphan) => orphan.path.toString());
  assert.ok(gitOrphanPaths.includes("scripts/deploy.sh"));
  const diskOrphanPaths = view.diskOrphans.map((orphan) => orphan.path.toString());
  assert.ok(diskOrphanPaths.includes("notes.txt"));
  assert.ok(DISK.some((entry) => entry.path === "notes.txt"));
});
