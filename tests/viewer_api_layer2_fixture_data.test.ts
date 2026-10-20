import assert from "node:assert/strict";
import { test } from "node:test";
import { SNAPSHOTS, listFixtureSnapshotPlacements } from "../src/viewer_api_layer2_fixture_data.ts";

test("util.ts carries @v2 from two different sessions", () => {
  const placements = listFixtureSnapshotPlacements("src/util.ts");
  const secondVersions = placements.filter((placement) => placement.version === 2);
  assert.equal(secondVersions.length, 2);
  assert.notEqual(secondVersions[0]!.sessionFile.toString(), secondVersions[1]!.sessionFile.toString());
});

test("placements ascend by instant and every snapshot has one", () => {
  const placements = listFixtureSnapshotPlacements("src/index.ts");
  assert.equal(placements.length, SNAPSHOTS.filter((snapshot) => snapshot.path === "src/index.ts").length);
  for (let index = 1; index < placements.length; index += 1) {
    assert.ok(placements[index]!.instant.getTime() >= placements[index - 1]!.instant.getTime());
  }
});
