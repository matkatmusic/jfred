// Pair ladder and axis placement: ladder order matches the offsets the placement reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { buildPairOnAxis, listPairNodeLadder, type PairHistory } from "../src/viewer_api_layer1_pair_place.ts";

const CREATED = new Date("2020-01-01T00:00:00Z");
const COMMIT = new Date("2020-02-01T00:00:00Z");
const MTIME = new Date("2020-03-01T00:00:00Z");

function makePairHistory(createdAt?: Date): PairHistory {
  return {
    file: { relativePath: new Path("a.txt"), mtime: MTIME, createdAt },
    commits: [{ hash: "abc", instant: COMMIT }],
  };
}

test("test_listPairNodeLadder_orders_created_commits_then_mtime", () => {
  assert.deepEqual(listPairNodeLadder(makePairHistory(CREATED)), [CREATED, COMMIT, MTIME]);
});

test("test_buildPairOnAxis_reads_offsets_positionally", () => {
  const pair = buildPairOnAxis(makePairHistory(CREATED), [10, 20, 30]);
  assert.equal(pair.created?.axisPx, 10);
  assert.equal(pair.commits[0]?.axisPx, 20);
  assert.equal(pair.onDisk.axisPx, 30);
});

test("test_buildPairOnAxis_drops_a_birth_after_the_first_commit", () => {
  const pair = buildPairOnAxis(makePairHistory(new Date("2020-02-15T00:00:00Z")), [20, 30]);
  assert.equal(pair.created, undefined);
  assert.equal(pair.commits[0]?.axisPx, 20);
  assert.equal(pair.onDisk.axisPx, 30);
});
