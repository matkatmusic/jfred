// Spec S5a (task 175) + the S4 corpus-load dedupe (design plans/166-multi-source-design.md §b/§c): record-level dedupe, wall-clock interleave, and per-session root resolution. The §a identity-join ladder tests live in reconstruction_multi_source_join.test.ts (250-line cap split).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { setPathOverrides, type SourceEntry } from "../src/reconstruction_overrides.ts";
import {
    dedupeRecordsBySessionAndUuid,
    interleaveRecordsByTimestamp,
    computeSessionRoots,
    mergeMultiSourceRecords,
} from "../src/reconstruction_multi_source.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { reconstructStepStates, snapshotFileText } from "../src/reconstruction_steps.ts";
import {
    SESSION_A,
    SESSION_B,
    makeSourceTree,
    makeTwoSourceEditFixture,
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
    // Scenario (§c1): the same record replicated across two sources (same sessionId + uuid) must survive exactly once, first occurrence winning.  Step: load one fixture transcript, then present its records twice in a row.
    const tree = makeSourceTree("-dedupe-project");
    const pair = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_dedupe", parentUuid: null },
        join(tree.treeRoot, "a.py"),
        "x\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", pair.records);
    // Test action: dedupe the replicated stream (each record present twice).
    const deduped = dedupeRecordsBySessionAndUuid([...records, ...records]);
    // Test verification: exactly the original records survive, first instances, in order.
    assert.equal(deduped.length, records.length);
    assert.equal(deduped[0], records[0]);
});

test("test_dedupe_keeps_records_missing_uuid_or_session", () => {
    // Scenario (§c1): records without a (sessionId, uuid) identity (e.g. file-history snapshots) must never be treated as duplicates of each other.
    const anonymous = [fabricateBareRecord({ type: "x" }), fabricateBareRecord({ type: "x" })];
    // Test action + verification: both identity-less records pass through.
    const deduped = dedupeRecordsBySessionAndUuid(anonymous);
    assert.equal(deduped.length, 2);
});

test("test_interleave_orders_records_across_sessions_by_wall_clock", () => {
    // Scenario (§c3): two sessions overlapping in time must merge into one strictly timestamp-ordered stream, each session's internal order preserved.
    const recordA1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:00:00.000Z") });
    const recordA2 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:10:00.000Z") });
    const recordB1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:05:00.000Z") });
    const recordB2 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:15:00.000Z") });
    // Test action: merge list A (t1,t3) with list B (t2,t4).
    const merged = interleaveRecordsByTimestamp([[recordA1, recordA2], [recordB1, recordB2]]);
    // Test verification: merged order is t1,t2,t3,t4.
    assert.deepEqual(merged, [recordA1, recordB1, recordA2, recordB2]);
});

test("test_interleave_keeps_unstamped_leading_records_with_their_session", () => {
    // Scenario (§c3): a session's unstamped leading record (a file-history snapshot) must stay glued in front of its session's first stamped record, not float to the stream head.
    const unstamped = fabricateBareRecord({ type: "file-history-snapshot" });
    const recordA1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:00:00.000Z") });
    const recordB1 = fabricateBareRecord({ timestamp: new Date("2026-07-22T10:05:00.000Z") });
    const merged = interleaveRecordsByTimestamp([[recordA1], [unstamped, recordB1]]);
    assert.deepEqual(merged, [recordA1, unstamped, recordB1]);
});

test("test_session_root_uses_declared_source_root_over_cwd", () => {
    // Scenario (§b3): a source entry declaring a root wins over the session's recorded cwd.
    const fixture = makeTwoSourceEditFixture("line one\n");
    const roots = computeSessionRoots(fixture.listA, fixture.sources);
    // Test verification: the declared root, not the cwd, is the session's root.
    assert.equal(roots.get(SESSION_A)?.toString(), fixture.sources[0]!.root!.toString());
});

test("test_session_root_auto_detects_from_first_cwd_when_source_declares_none", () => {
    // Scenario (§b2): with no declared root, the session's first recorded cwd is the root.
    const fixture = makeTwoSourceEditFixture("line one\n");
    const rootlessSources: SourceEntry[] = [{ projectsDir: fixture.sources[0]!.projectsDir }];
    const roots = computeSessionRoots(fixture.listA, rootlessSources);
    // Test verification: auto-detect lands on the fixture's recorded cwd (workspace-alpha).
    assert.equal(roots.get(SESSION_A)?.toString(), fixture.rootA);
});

test("test_single_source_records_pass_through_unchanged", () => {
    // Scenario: one list under one root is the degenerate case — merge must return the same records in the same order (dedupe, interleave, and join are all no-ops).
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
    // Scenario (task 179, s89): session A's root is <proj>, session B's root is the NESTED <proj>/tests — the same file is tests/test_x.py under A but test_x.py under B, while its ABSOLUTE path is identical. Identity must fall out of the merged stream (absolute-path fast path); the rel-path join must not split or remap it.
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
    const steps = reconstructStepStates(merged, buildSidecarReader(merged, sources));
    // Test verification: three engine steps carry the ONE interleaved ladder (engine text drops the trailing newline).
    const ladder = steps.map((step) => snapshotFileText(step, filePath));
    assert.deepEqual(ladder, versions.map((text) => text.slice(0, -1)));
});
