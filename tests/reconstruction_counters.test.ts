import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ReconstructionCounter,
    formatReconstructionCountersLine,
    incrementReconstructionCounter,
    resetReconstructionCounters,
    snapshotReconstructionCounters,
} from "../src/reconstruction_counters.ts";
import { executeRunOnce } from "../src/reconstruction_script_runs.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// A reader with no backups to offer — the read-only skip path never consults it anyway.
const emptyReader: BackupReader = () => "";

test("test_counter_increment_and_snapshot", () => {
    // Scenario: incrementing one counter twice shows 2 in the snapshot; untouched counters read 0.
    // Steps:
    // start from a clean slate.
    resetReconstructionCounters();
    // increment one counter twice.
    incrementReconstructionCounter(ReconstructionCounter.preStateBuilds);
    incrementReconstructionCounter(ReconstructionCounter.preStateBuilds);
    // the snapshot reports 2 for it and 0 for an untouched sibling.
    const snapshot = snapshotReconstructionCounters();
    assert.equal(snapshot[ReconstructionCounter.preStateBuilds], 2);
    assert.equal(snapshot[ReconstructionCounter.sandboxSpawns], 0);
});

test("test_counter_reset_zeroes_all", () => {
    // Scenario: reset returns every counter to 0.
    // Steps:
    // increment a counter, then reset.
    resetReconstructionCounters();
    incrementReconstructionCounter(ReconstructionCounter.executionRequests);
    resetReconstructionCounters();
    // the snapshot reports 0 for it.
    assert.equal(snapshotReconstructionCounters()[ReconstructionCounter.executionRequests], 0);
});

test("test_counters_line_reports_every_counter", () => {
    // Scenario: the CLI's stderr line is `counters: {…}` JSON with every counter present.
    // Steps:
    // from a clean slate, format the line.
    resetReconstructionCounters();
    const line = formatReconstructionCountersLine();
    // it parses as JSON after the prefix and carries all enum members at 0.
    assert.ok(line.startsWith("counters: "));
    const parsed = JSON.parse(line.slice("counters: ".length)) as Record<string, number>;
    for (const counter of Object.values(ReconstructionCounter)) {
        assert.equal(parsed[counter], 0);
    }
});

test("test_execute_run_once_counts_request_and_cache_hit", () => {
    // Scenario: executeRunOnce tallies one executionRequests per call and one
    // executionCacheHits when the memo answers.
    // Steps:
    // build a read-only python run (no pre-state build, no sandbox spawn needed).
    resetReconstructionCounters();
    const records: TranscriptRecord[] = [];
    const run: ScriptRun = { code: 'print("hi")', timestamp: new Date("2026-01-01T00:00:01Z") };
    // drive it through executeRunOnce twice against the SAME records identity.
    executeRunOnce(run, records, emptyReader);
    executeRunOnce(run, records, emptyReader);
    // two requests, one cache hit, zero pre-state builds and sandbox spawns.
    const snapshot = snapshotReconstructionCounters();
    assert.equal(snapshot[ReconstructionCounter.executionRequests], 2);
    assert.equal(snapshot[ReconstructionCounter.executionCacheHits], 1);
    assert.equal(snapshot[ReconstructionCounter.preStateBuilds], 0);
    assert.equal(snapshot[ReconstructionCounter.sandboxSpawns], 0);
});
