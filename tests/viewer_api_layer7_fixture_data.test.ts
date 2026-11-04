import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";
import {
  ANNOTATION_BLOCK_IDS, TOOL_NODE_IDS, TOOL_NODE_PATH, buildFixtureAnnotations, listFillerIds, listToolNodeInstants,
} from "../src/viewer_api_layer7_fixture_data.ts";
import { buildFixturePair } from "../src/viewer_api_layer1_fixture_pair.ts";

const SRC_DIR = join(import.meta.dirname, "..", "src");
const TICK_COUNT = 300;

function buildRuler(tickCount: number) {
  const firstMs = Date.parse("2026-06-01T08:00:00Z");
  return Array.from({ length: tickCount }, (_, tick) => ({
    instant: new Date(firstMs + tick * 3600_000), axisPx: tick * 16, eventCount: 1,
  }));
}

function listBlock() {
  return buildFixtureAnnotations(buildRuler(TICK_COUNT)).slice(0, ANNOTATION_BLOCK_IDS.length);
}

test("test_block_holds_eight_distinct_kinds_including_unknown", () => {
  // the first 8 records are the column block.
  const kinds = new Set(listBlock().map((record) => record.kind));
  assert.equal(kinds.size, 8);
  assert.ok(kinds.has(WireRecordKind.unknown));
  assert.equal(listBlock()[6]!.label, "worktree-state");
});

test("test_stampless_record_borrows_the_instant_of_its_predecessor", () => {
  const block = listBlock();
  const stampless = block.filter((record) => record.isStampless === true);
  assert.equal(stampless.length, 1);
  assert.equal(block[7]!.isStampless, true);
  assert.equal(block[7]!.instant.getTime(), block[6]!.instant.getTime());
});

test("test_column_tool_pair_wraps_the_ignored_attachment", () => {
  // tool_use is record 2, attachment record 3, tool_result record 5.
  const block = listBlock();
  const toolUse = block[2]!;
  const toolResult = block[5]!;
  assert.equal(toolUse.pairId?.toString(), "toolu_fixture_l7_bash");
  assert.equal(toolResult.pairId?.toString(), "toolu_fixture_l7_bash");
  const attachmentMs = block[3]!.instant.getTime();
  assert.ok(toolUse.instant.getTime() < attachmentMs);
  assert.ok(attachmentMs < toolResult.instant.getTime());
});

test("test_ids_are_unique_filler_is_sixty_and_exactly_two_are_ignored", () => {
  const records = buildFixtureAnnotations(buildRuler(TICK_COUNT));
  const ids = records.map((record) => record.id.toString());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(listFillerIds().length, 60);
  assert.equal(records.length, ANNOTATION_BLOCK_IDS.length + 60);
  assert.equal(records.filter((record) => record.isIgnored === true).length, 2);
});

test("test_filler_alternates_user_and_assistant_in_ascending_order", () => {
  const filler = buildFixtureAnnotations(buildRuler(TICK_COUNT)).slice(ANNOTATION_BLOCK_IDS.length);
  assert.equal(filler[0]!.kind, WireRecordKind.user);
  assert.equal(filler[1]!.kind, WireRecordKind.assistant);
  for (let index = 1; index < filler.length; index += 1) {
    assert.ok(filler[index]!.instant.getTime() >= filler[index - 1]!.instant.getTime());
  }
});

test("test_an_empty_ruler_throws", () => {
  assert.throws(() => buildFixtureAnnotations([]));
});

test("test_grep_and_the_tool_ids_appear_in_no_other_fixture_file", () => {
  // every other fixture source file must stay free of the L7 names.
  const others = readdirSync(SRC_DIR).filter((name) => /^viewer_api_layer\d_fixture/.test(name) && !name.includes("layer7"));
  assert.ok(others.length > 5);
  for (const name of others) {
    const source = readFileSync(join(SRC_DIR, name), "utf8");
    assert.ok(!source.includes("Grep"), `${name} mentions Grep`);
    assert.ok(!source.includes("toolu_fixture_l7_"), `${name} mentions an L7 tool id`);
  }
});

test("test_the_two_bubble_instants_tie_no_other_node_of_that_path", () => {
  const ladder = buildFixturePair(TOOL_NODE_PATH).ladder;
  const distinctMs = new Set(ladder.map((instant) => instant.getTime()));
  assert.equal(distinctMs.size, ladder.length);
  assert.equal(listToolNodeInstants(TOOL_NODE_PATH).length, 2);
  assert.equal(TOOL_NODE_IDS.length, 2);
  assert.deepEqual(listToolNodeInstants("src/index.ts"), []);
});

test("test_bubble_records_are_not_in_the_column", () => {
  const columnIds = new Set(buildFixtureAnnotations(buildRuler(TICK_COUNT)).map((record) => record.id.toString()));
  for (const id of TOOL_NODE_IDS) {
    assert.ok(!columnIds.has(id.toString()));
  }
});
