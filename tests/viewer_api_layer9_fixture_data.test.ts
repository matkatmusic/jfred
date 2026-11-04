// Test for src/viewer_api_layer9_fixture_data.ts: the canned jfred base and two commits sit on real fixture ticks.

import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMITS } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { JFRED_BASE_AT, buildFixtureJfredCommits } from "../src/viewer_api_layer9_fixture_data.ts";

const FOOTNOTE_PREFIX = "reconstructed by JFRED @ ";

interface BeaconNode {
  instantMs: number;
  label: string;
}

function listBeaconNodes(pair: ReturnType<typeof buildFixtureLayer1View>["pairs"][number]): BeaconNode[] {
  const nodes: BeaconNode[] = [];
  for (const commit of pair.commits) nodes.push({ instantMs: commit.instant.getTime(), label: commit.hash.slice(0, 8) });
  nodes.push({ instantMs: pair.onDisk.instant.getTime(), label: "on disk" });
  for (const snap of pair.snapshots ?? []) nodes.push({ instantMs: snap.instant.getTime(), label: `@v${snap.version} 📸${snap.isBackupMissing ? "🚫" : ""}` });
  return nodes;
}

function listBeaconInstantsMs(): Set<number> {
  const instants = new Set<number>();
  for (const pair of buildFixtureLayer1View().pairs) {
    for (const node of listBeaconNodes(pair)) instants.add(node.instantMs);
  }
  return instants;
}

function listExpectedSnapLines(markMs: number): string[] {
  const lines: string[] = [];
  for (const pair of buildFixtureLayer1View().pairs) {
    let latest: BeaconNode | undefined;
    for (const node of listBeaconNodes(pair)) {
      if (node.instantMs <= markMs && (latest === undefined || node.instantMs > latest.instantMs)) latest = node;
    }
    if (latest !== undefined) lines.push(`${pair.path.toString()}: ${latest.label} at ${new Date(latest.instantMs).toISOString()}`);
  }
  return lines;
}

function readCanned() {
  const canned = buildFixtureJfredCommits();
  assert.ok(canned !== undefined);
  return canned;
}

test("test_base_is_the_real_commit_a1b2c3d4_on_a_ruler_tick", () => {
  // Verify: the base is a fixture commit, and its instant is a ruler tick.
  const canned = readCanned();
  assert.equal(canned.base.shortHash, "a1b2c3d4");
  assert.equal(canned.base.instant.getTime(), JFRED_BASE_AT.getTime());
  assert.ok(COMMITS.some((commit) => commit.hash === "a1b2c3d4" && Date.parse(commit.at) === JFRED_BASE_AT.getTime()));
  assert.ok(buildFixtureLayer1View().ruler.some((tick) => tick.instant.getTime() === JFRED_BASE_AT.getTime()));
});

test("test_parents_grow_a_prefix_and_instants_rise", () => {
  // Verify: commit 1 follows the base, commit 2 follows commit 1, times rise.
  const { base, commits } = readCanned();
  assert.equal(commits.length, 2);
  const [first, second] = commits;
  assert.equal(first!.parentShortHash, base.shortHash);
  assert.equal(second!.parentShortHash, first!.shortHash);
  assert.ok(base.instant.getTime() < first!.instant.getTime());
  assert.ok(first!.instant.getTime() < second!.instant.getTime());
});

test("test_every_mark_is_a_ruler_tick_with_a_non_created_beacon_node", () => {
  // Verify: base and both commits sit on ticks that hold a commit, on-disk or snapshot node.
  const { base, commits } = readCanned();
  const tickMs = new Set<number>();
  for (const tick of buildFixtureLayer1View().ruler) tickMs.add(tick.instant.getTime());
  const beaconMs = listBeaconInstantsMs();
  for (const mark of [base, ...commits]) {
    assert.ok(tickMs.has(mark.instant.getTime()), mark.shortHash);
    assert.ok(beaconMs.has(mark.instant.getTime()), mark.shortHash);
  }
});

test("test_commit_2_counts_the_beacon_ticks_between_its_parent_and_itself", () => {
  // Verify: the includes line holds N, and N equals the beacon instants strictly between.
  const { commits } = readCanned();
  const [first, second] = commits;
  let between = 0;
  for (const instantMs of listBeaconInstantsMs()) {
    if (instantMs > first!.instant.getTime() && instantMs < second!.instant.getTime()) between++;
  }
  assert.equal(between, 2);
  assert.ok(second!.message.includes("includes 2 unmarked changes"));
  assert.equal(first!.message.includes("unmarked"), false);
});

test("test_every_message_ends_with_the_footnote_and_lists_the_expected_file_lines", () => {
  // Verify: the last line starts with the footnote, and every expected snap line is present.
  for (const commit of readCanned().commits) {
    assert.ok(commit.message.split("\n").at(-1)!.startsWith(FOOTNOTE_PREFIX));
    const lines = commit.message.split("\n");
    const expected = listExpectedSnapLines(commit.instant.getTime());
    assert.ok(expected.length > 0);
    for (const line of expected) assert.ok(lines.includes(line), line);
  }
});

test("test_commit_hashes_collide_with_no_fixture_commit_hash", () => {
  // Verify: the two canned commit hashes are new.
  const fixtureHashes = new Set<string>();
  for (const commit of COMMITS) fixtureHashes.add(commit.hash);
  for (const commit of readCanned().commits) assert.equal(fixtureHashes.has(commit.shortHash), false, commit.shortHash);
});
