// Spec S5a (task 175): record dedupe, wall-clock interleave, per-session root resolution. Join-ladder tests: reconstruction_multi_source_join.test.ts.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { setPathOverrides, type SourceEntry } from "../src/reconstruction_overrides.ts";
import {
    removeDuplicateRecordsBySessionAndUuid,
    mergeRecordsByTimestamp,
    mergeMultiSourceRecords,
} from "../src/reconstruction_multi_source.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { buildStepStates } from "../src/reconstruction_steps.ts";
import { getSnapshotFileText } from "../src/reconstruction_step_snapshot.ts";
import {
    SESSION_A,
    SESSION_B,
    makeSourceTree,
    buildWriteRecordPair,
    buildEditRecordPair,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

// A bare record literal for the order/dedupe tests that never reach extraction.
function fabricateBareRecord(fields: object): TranscriptRecord {
    return fields as unknown as TranscriptRecord;
}

test("test_dedupe_drops_replicated_records_keeping_first", () => {
    // Scenario (§c1): a record in two sources survives once, first occurrence winning. Step: feed one fixture's records twice.
    const tree = makeSourceTree("-dedupe-project");
    const pair = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_dedupe", parentUuid: null },
        join(tree.treeRoot, "a.py"),
        "x\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", pair.records);
    // Test action: dedupe the replicated stream (each record present twice).
    const deduped = removeDuplicateRecordsBySessionAndUuid([...records, ...records]);
    // Test verification: exactly the original records survive, first instances, in order.
    assert.equal(deduped.length, records.length);
    assert.equal(deduped[0], records[0]);
});

test("test_dedupe_keeps_records_missing_uuid_or_session", () => {
    // Scenario (§c1): records lacking a (sessionId, uuid) identity are never duplicates of each other.
    const anonymous = [fabricateBareRecord({ type: "x" }), fabricateBareRecord({ type: "x" })];
    // Test action + verification: both identity-less records pass through.
    const deduped = removeDuplicateRecordsBySessionAndUuid(anonymous);
    assert.equal(deduped.length, 2);
});

test("test_interleave_orders_records_across_sessions_by_wall_clock", () => {
    // Scenario (§c3): two sessions overlapping in time must merge into one strictly timestamp-ordered stream, each session's internal order preserved.
    const recordA1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:00:00.000Z") });
    const recordA2 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:10:00.000Z") });
    const recordB1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:05:00.000Z") });
    const recordB2 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:15:00.000Z") });
    // Test action: merge list A (t1,t3) with list B (t2,t4).
    const merged = mergeRecordsByTimestamp([[recordA1, recordA2], [recordB1, recordB2]]);
    // Test verification: merged order is t1,t2,t3,t4.
    assert.deepEqual(merged, [recordA1, recordB1, recordA2, recordB2]);
});

test("test_interleave_keeps_unstamped_leading_records_with_their_session", () => {
    // Scenario (§c3): a session's unstamped leading record stays before its first stamped record, not at the stream head.
    const unstamped = fabricateBareRecord({ type: "file-history-snapshot" });
    const recordA1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:00:00.000Z") });
    const recordB1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:05:00.000Z") });
    const merged = mergeRecordsByTimestamp([[recordA1], [unstamped, recordB1]]);
    assert.deepEqual(merged, [recordA1, unstamped, recordB1]);
});

test("test_single_source_records_pass_through_unchanged", () => {
    // Scenario: one list under one root: merge returns the same records in the same order.
    const tree = makeSourceTree("-single-project");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const pair = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_solo", parentUuid: null },
        join(workspaceRoot, "solo.py"),
        "solo\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", pair.records);
    const sources: SourceEntry[] = [{ projectsDir: new Path(join(tree.treeRoot, "projects")) }];
    const merged = mergeMultiSourceRecords([records], sources);
    assert.deepEqual(merged, records);
});

test("test_nested_root_sessions_keep_one_ladder_for_one_absolute_path", () => {
    // Scenario (task 179, s89): nested session roots give one file two relative paths: the absolute path keeps one ladder.
    const treeA = makeSourceTree("-scen89-proj");
    const treeB = makeSourceTree("-scen89-proj-tests");
    const rootA = join(treeA.treeRoot, "proj");
    const rootB = join(rootA, "tests");
    const filePath = join(rootA, "tests", "test_x.py");
    const versions = [
        "def test_a():\n    assert True\n",
        "def test_a():\n    assert True\ndef test_b():\n    assert True\n",
        "def test_a():\n    assert True\ndef test_b():\n    assert True\ndef test_c():\n    assert True\n",
    ];
    const write = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_w_a1", parentUuid: null },
        filePath, versions[0]!,
    );
    const editB = buildEditRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_e_b1", parentUuid: null },
        filePath, versions[1]!, versions[0]!,
        { oldStart: 2, oldLines: 1, newStart: 2, newLines: 3, lines: ["     assert True", "+def test_b():", "+    assert True"] },
    );
    const editA = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:10:00.000Z", toolId: "toolu_e_a2", parentUuid: "toolu_w_a1-result" },
        filePath, versions[2]!, versions[1]!,
        { oldStart: 4, oldLines: 1, newStart: 4, newLines: 3, lines: ["     assert True", "+def test_c():", "+    assert True"] },
    );
    const listA = writeTranscriptFixture(treeA.projectDir, "a.jsonl", [...write.records, ...editA.records]);
    const listB = writeTranscriptFixture(treeB.projectDir, "b.jsonl", editB.records);
    const sources: SourceEntry[] = [
        { projectsDir: new Path(join(treeA.treeRoot, "projects")), root: new Path(rootA) },
        { projectsDir: new Path(join(treeB.treeRoot, "projects")), root: new Path(rootB) },
    ];
    const merged = mergeMultiSourceRecords([listA, listB], sources);
    const steps = buildStepStates(merged, buildSidecarReader(merged, sources));
    // Test verification: three engine steps carry the ONE interleaved ladder (engine text drops the trailing newline).
    const ladder = steps.map((step) => getSnapshotFileText(step, filePath));
    assert.deepEqual(ladder, versions.map((text) => text.slice(0, -1)));
});
