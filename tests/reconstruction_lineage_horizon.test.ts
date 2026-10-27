// tests/reconstruction_lineage_horizon.test.ts — the task-220 horizon key for the lineage-seed
// memo: two query instants share a key exactly when no relevant input (own static lineage event,
// script run that could touch the file, post-first-touch flood) lies between them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLineageSeedHorizonKey } from "../src/reconstruction_lineage_horizon.ts";
import { getLineageContentBefore } from "../src/reconstruction_lineage_content.ts";
import {
    ReconstructionCounter,
    resetReconstructionCounters,
    snapshotReconstructionCounters,
} from "../src/reconstruction_counters.ts";
import { getDerivedCaches } from "../src/reconstruction_corpus.ts";
import { computeRunExecutionKey } from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A reader with no backups to offer — identity only matters for the derived-cache group.
const emptyReader: BackupReader = () => "";

const TARGET = new Path("/proj/plate.py");

test("test_horizon_key_is_stable_across_instants_with_no_inputs_between", () => {
    // Scenario: one Write, then nothing; two later queries share the horizon key, so the second reuses the first's seed.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(earlyKey, lateKey);
});

test("test_static_lineage_event_between_instants_changes_the_key", () => {
    // Scenario: a second Write of the target lands between the two queries, so the keys must differ.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v2\n" }, "2026-01-01T00:00:15Z", "/proj"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.notEqual(earlyKey, lateKey);
});

test("test_unexecuted_eligible_run_between_instants_changes_the_key", () => {
    // Scenario: an unexecuted write-capable python run sits between the instants; its effects are unknown, so the horizon bumps.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.notEqual(earlyKey, lateKey);
});

test("test_read_only_and_bash_runs_never_bump_even_unexecuted", () => {
    // Scenario: unexecuted read-only python and bash runs sit between the instants; neither makes a post-state, so keys match.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'print("hello")\n' }, "2026-01-01T00:00:14Z"),
        buildToolRecord(ToolName.Bash, { command: "rm -f /tmp/x && touch /tmp/y" }, "2026-01-01T00:00:15Z"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(earlyKey, lateKey);
});

test("test_static_event_of_unrelated_file_floods_after_first_script_touch", () => {
    // Scenario: after a run provably touches the target, any later static event, even an unrelated one, bumps the horizon.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:02Z"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/unrelated.txt", content: "g\n" }, "2026-01-01T00:00:15Z", "/proj"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    getDerivedCaches(records, emptyReader).executionsByRun.set(computeRunExecutionKey(run), {
        pre: new Map([["plate.py", "v1\n"]]),
        post: new Map([["plate.py", "scripted\n"]]),
    });
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.notEqual(earlyKey, lateKey);
});

test("test_second_query_between_inputs_serves_the_cached_seed", () => {
    // Scenario: two lineage-seed queries with no relevant input between them pay one replay; the second uses the cache.
    resetReconstructionCounters();
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const seedContent = getLineageContentBefore(records, emptyReader);
    const firstText = seedContent(TARGET, new Date("2026-01-01T00:00:10Z"));
    const secondText = seedContent(TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(firstText, "v1\n");
    assert.equal(secondText, firstText);
    const snapshot = snapshotReconstructionCounters();
    assert.equal(snapshot[ReconstructionCounter.lineageReplayRequests], 2);
    assert.equal(snapshot[ReconstructionCounter.lineageCacheServes], 1);
});
