import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { Path } from "../src/structures/domain.ts";
import {
  SCENARIO_ROOTS,
  findScenarioDir,
  findScenarioJsonl,
  getScenarioJsonlPaths,
  listScenarioJsonlPaths,
} from "./scenario-locator.ts";

test("test_find_scenario_jsonl_returns_jsonl_inside_named_dir", () => {
    // Scenario: s1 resolves to a .jsonl file whose parent dir is the s1 scenario dir.
    const jsonl = findScenarioJsonl("s1-delete-file");
    assert.ok(jsonl.endsWith(".jsonl"));
    assert.equal(basename(dirname(jsonl)), "s1-delete-file");
});

test("test_find_scenario_jsonl_throws_for_missing_dir", () => {
    // Scenario: an unknown scenario dir fails loudly.
    assert.throws(() => findScenarioJsonl("no-such-scenario"), /no \.jsonl found/);
});

test("test_find_scenario_dir_returns_dir_holding_jsonl", () => {
    // Scenario: the resolved dir is the parent of the single-transcript lookup.
    const dir = findScenarioDir(SCENARIO_ROOTS, "s1-delete-file");
    assert.equal(dir, dirname(findScenarioJsonl("s1-delete-file")));
});

test("test_find_scenario_dir_throws_for_missing_dir", () => {
    // Scenario: a missing dir fails loudly.
    assert.throws(() => findScenarioDir(SCENARIO_ROOTS, "no-such-scenario"), /no directory with \.jsonl/);
});

test("test_list_scenario_jsonl_paths_lists_sorted_transcripts", () => {
    // Scenario: every listed path is a sorted .jsonl inside the dir.
    const dir = new Path(findScenarioDir(SCENARIO_ROOTS, "s1-delete-file"));
    const paths = listScenarioJsonlPaths(dir);
    assert.ok(paths.length > 0);
    const names = paths.map((path) => basename(path.value));
    assert.deepEqual(names, [...names].sort());
});

test("test_get_scenario_jsonl_paths_throws_for_unknown_id", () => {
    // Scenario: an uncaptured scenario id fails loudly.
    assert.throws(() => getScenarioJsonlPaths("no-such-id"), /no covered scenario with id/);
});
