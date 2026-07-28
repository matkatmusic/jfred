// tests/reconstruction_lineage_horizon.test.ts — the task-220 horizon key for the lineage-seed
// memo: two query instants share a key exactly when no relevant input (own static lineage event,
// script run that could touch the file, post-first-touch flood) lies between them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLineageSeedHorizonKey } from "../src/reconstruction_lineage_horizon.ts";
import { getLineageContentBefore } from "../src/reconstruction_branches.ts";
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
    // Scenario: one Write of the target and nothing afterwards — two later query instants share the horizon key, so the second query can serve the first query's cached seed.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(earlyKey, lateKey);
});

test("test_static_lineage_event_between_instants_changes_the_key", () => {
    // Scenario: a second Write of the target lands between the two query instants — the keys must differ (the later query sees one more revision).
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v2\n" }, "2026-01-01T00:00:15Z", "/proj"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.notEqual(earlyKey, lateKey);
});

test("test_unexecuted_eligible_run_between_instants_changes_the_key", () => {
    // Scenario: a write-capable python run with NO memoized execution sits between the two instants — its effects are unknown, so the horizon must bump conservatively.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("other.txt", "w").write("x")\n' }, "2026-01-01T00:00:15Z"),
    ];
    const earlyKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:10Z"));
    const lateKey = computeLineageSeedHorizonKey(records, emptyReader, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.notEqual(earlyKey, lateKey);
});

test("test_run_memoized_as_skip_never_bumps_the_horizon", () => {
    // Scenario: the same in-between run is memoized as an executed SKIP (post: undefined) — a skip can never inject events or rename pairs, so the keys now match.
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
    // Scenario: the in-between run's memoized sandbox diff changed the target's state key — the run is proven relevant, so the keys must differ.
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
    // Scenario: the in-between run executed and changed only an unrelated file — irrelevant to the target, so the keys match.
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

test("test_read_only_and_bash_runs_never_bump_even_unexecuted", () => {
    // Scenario: a provably read-only python run and a bash-executor run sit between the instants, both unexecuted — neither can ever produce a post-state, so the keys match.
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
    // Scenario: once a run PROVABLY touched the target, a proven script move could splice another path's later history into the target's chain — so any later static event, even of an unrelated file, must bump the horizon.
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
    // Scenario: the end-to-end win — two lineage-seed queries at different instants with no relevant input between them pay ONE replay; the second serves the cached seed text.
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

test("test_run_scan_refreshes_when_a_new_execution_is_memoized", () => {
    // Scenario: the per-target run scan is reused while executionsByRun has not grown, and recomputed when a new execution lands.  Steps: with the run unexecuted the key at t20 reflects the conservative bump.
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
