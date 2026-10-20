import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixturePair, sortByInstant } from "../src/viewer_api_layer1_fixture_pair.ts";

test("a file with born before mtime has a created instant and an ascending commit list", () => {
  const pair = buildFixturePair("src/index.ts");
  assert.ok(pair.created !== undefined);
  assert.ok(pair.commits.length >= 3);
  for (let index = 1; index < pair.commits.length; index += 1) {
    assert.ok(pair.commits[index]!.instant.getTime() >= pair.commits[index - 1]!.instant.getTime());
  }
});

test("README.md was born at its mtime so it has no created instant; sortByInstant orders rows", () => {
  assert.equal(buildFixturePair("README.md").created, undefined);
  const sorted = sortByInstant([{ instant: new Date(2) }, { instant: new Date(1) }]);
  assert.equal(sorted[0]!.instant.getTime(), 1);
});
