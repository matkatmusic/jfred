import assert from "node:assert/strict";
import { test } from "node:test";
import { DISK } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { TOOL_NODE_PATH } from "../src/viewer_api_layer7_fixture_data.ts";
import { ANNOTATION_MID_IDS } from "../src/viewer_api_layer7_fixture_sessions.ts";

test("the fixture view carries every bulk file as a bubble", () => {
  const view = buildFixtureLayer1View();
  const bubbleCount = view.pairs.length + view.gitOrphans.length + view.diskOrphans.length;
  assert.ok(bubbleCount >= 88, `expected the ~88-bubble fixture, got ${bubbleCount}`);
});

test("test_view_carries_annotations_and_one_pair_with_two_tool_nodes", () => {
  const view = buildFixtureLayer1View();
  // 8 block, 60 filler, 12 between rows, 1 same instant, 352 made-up row lines.
  // assert.equal(view.annotations?.length, 81);
  assert.equal(view.annotations?.length, 81 + 352);
  const withToolNodes = view.pairs.filter((pair) => pair.toolNodes !== undefined);
  assert.equal(withToolNodes.length, 1);
  const pair = withToolNodes[0]!;
  assert.equal(pair.path.toString(), TOOL_NODE_PATH);
  assert.equal(pair.toolNodes!.length, 2);
  // the tool offsets sit after the on-disk offset in ladder order, so they were sliced from the layout.
  const axisValues = pair.toolNodes!.map((toolNode) => toolNode.axisPx);
  assert.ok(axisValues.every((axisPx) => Number.isFinite(axisPx)));
  assert.equal(axisValues[0]! < axisValues[1]!, true);
});

test("test_view_carries_jfred_commits_with_two_commits", () => {
  const view = buildFixtureLayer1View();
  assert.equal(view.jfredCommits?.commits.length, 2);
  assert.equal(view.jfredCommits?.base.shortHash, "a1b2c3d4");
});

test("test_annotation_instants_land_on_ruler_ticks", () => {
  const view = buildFixtureLayer1View();
  const tickMs = new Set(view.ruler.map((tick) => tick.instant.getTime()));
  const midIds = new Set(ANNOTATION_MID_IDS.map((id) => id.toString()));
  for (const annotation of view.annotations!) {
    if (midIds.has(annotation.id.toString())) {
      continue;
    }
    assert.ok(tickMs.has(annotation.instant.getTime()), annotation.label);
  }
});

test("commit-only paths become git orphans and disk-only paths become disk orphans", () => {
  const view = buildFixtureLayer1View();
  const gitOrphanPaths = view.gitOrphans.map((orphan) => orphan.path.toString());
  assert.ok(gitOrphanPaths.includes("scripts/deploy.sh"));
  const diskOrphanPaths = view.diskOrphans.map((orphan) => orphan.path.toString());
  assert.ok(diskOrphanPaths.includes("notes.txt"));
  assert.ok(DISK.some((entry) => entry.path === "notes.txt"));
});
