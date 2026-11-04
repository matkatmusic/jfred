import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixturePair, sortByInstant } from "../src/viewer_api_layer1_fixture_pair.ts";
import { TOOL_NODE_PATH, listToolNodeInstants } from "../src/viewer_api_layer7_fixture_data.ts";

test("a file with born before mtime has a created instant and an ascending commit list", () => {
  const pair = buildFixturePair("src/index.ts");
  assert.ok(pair.created !== undefined);
  assert.ok(pair.commits.length >= 3);
  for (let index = 1; index < pair.commits.length; index += 1) {
    assert.ok(pair.commits[index]!.instant.getTime() >= pair.commits[index - 1]!.instant.getTime());
  }
});

test("test_dispatcher_pair_ladder_ends_with_the_two_tool_instants", () => {
  // the dispatcher pair carries 2 tool instants, and they are the last 2 ladder entries.
  const pair = buildFixturePair(TOOL_NODE_PATH);
  assert.equal(pair.toolNodes.length, 2);
  assert.deepEqual(pair.ladder.slice(-2), pair.toolNodes);
  assert.deepEqual(pair.toolNodes, listToolNodeInstants(TOOL_NODE_PATH));
  // every other pair has none.
  assert.deepEqual(buildFixturePair("src/index.ts").toolNodes, []);
});

test("README.md was born at its mtime so it has no created instant; sortByInstant orders rows", () => {
  assert.equal(buildFixturePair("README.md").created, undefined);
  const sorted = sortByInstant([{ instant: new Date(2) }, { instant: new Date(1) }]);
  assert.equal(sorted[0]!.instant.getTime(), 1);
});
