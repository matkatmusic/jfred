import { test } from "node:test";
import assert from "node:assert/strict";
import { getRunScanForTarget } from "../src/reconstruction_lineage_run_scan.ts";
import { computeLineageSeedHorizonKey } from "../src/reconstruction_lineage_horizon.ts";
import { computeRunExecutionKey } from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import { getDerivedCaches } from "../src/reconstruction_corpus.ts";
import { getStaticInputsForTarget } from "../src/reconstruction_lineage_inputs.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

const emptyReader: BackupReader = () => "";
const TARGET = new Path("/proj/plate.py");

// With no script runs, the scan finds no relevant instants and is cached per target.
test("test_run_scan_with_no_script_runs_is_empty_and_cached", () => {
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const derived = getDerivedCaches(records, emptyReader);
    const inputs = getStaticInputsForTarget(records, TARGET);
    const scan = getRunScanForTarget(records, derived, TARGET, inputs);
    assert.deepEqual(scan.relevantInstantsMs, []);
    assert.equal(scan.firstDiffRelevantMs, undefined);
    assert.equal(getRunScanForTarget(records, derived, TARGET, inputs), scan);
});

test("test_run_memoized_as_skip_never_bumps_the_horizon", () => {
    // Scenario: the in-between run is memoized as a skip (post: undefined), so it injects nothing and the keys match.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    getDerivedCaches(records, emptyReader).executionsByRun.set(computeRunExecutionKey(run), { pre: new Map(), post: undefined });
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(earlyKey, lateKey);
});

test("test_memoized_run_whose_diff_touches_the_target_changes_the_key", () => {
    // Scenario: the in-between run's memoized sandbox diff changed the target's state key; the run is relevant, so keys differ.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
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

test("test_memoized_run_whose_diff_touches_only_unrelated_keys_never_bumps", () => {
    // Scenario: the executed in-between run changed only an unrelated file, irrelevant to the target, so keys match.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    getDerivedCaches(records, emptyReader).executionsByRun.set(computeRunExecutionKey(run), {
        pre: new Map([["other.txt", "a\n"]]),
        post: new Map([["other.txt", "b\n"]]),
    });
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(earlyKey, lateKey);
});

test("test_run_scan_refreshes_when_a_new_execution_is_memoized", () => {
    // Scenario: the run scan is reused until executionsByRun grows, then recomputed.  Steps: with the run unexecuted, t20's key bumps.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
    ];
    const lateInstant = new Date("2026-01-01T00:00:20Z");
    const unexecutedKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, lateInstant);
    // the same query twice is idempotent (the scan is reused, not recomputed).
    assert.equal(computeLineageSeedHorizonKey(records, emptyReader, TARGET, lateInstant), unexecutedKey);
    // memoizing the run as an irrelevant execution grows the map — the scan refreshes and the conservative bump disappears.
    const run = findScriptExecutionRuns(records)[0]!;
    getDerivedCaches(records, emptyReader).executionsByRun.set(computeRunExecutionKey(run), {
        pre: new Map([["other.txt", "a\n"]]),
        post: new Map([["other.txt", "b\n"]]),
    });
    const executedKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, lateInstant);
    assert.notEqual(executedKey, unexecutedKey);
});
