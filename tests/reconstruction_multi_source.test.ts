// Spec S5a (task 175) + the S4 corpus-load dedupe (design plans/166-multi-source-design.md §b/§c):
// record-level dedupe, wall-clock interleave, and per-session root resolution. The §a identity-join
// ladder tests live in reconstruction_multi_source_join.test.ts (250-line cap split).

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
import {
    SESSION_A,
    makeSourceTree,
    makeTwoSourceEditFixture,
    buildWriteRecordPair,
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
    // Scenario (§c1): the same record replicated across two sources (same sessionId + uuid)
    // must survive exactly once, first occurrence winning.
    // Step: load one fixture transcript, then present its records twice in a row.
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
    // Scenario (§c1): records without a (sessionId, uuid) identity (e.g. file-history
    // snapshots) must never be treated as duplicates of each other.
    const anonymous = [fabricateBareRecord({ type: "x" }), fabricateBareRecord({ type: "x" })];
    // Test action + verification: both identity-less records pass through.
    const deduped = dedupeRecordsBySessionAndUuid(anonymous);
    assert.equal(deduped.length, 2);
});

test("test_interleave_orders_records_across_sessions_by_wall_clock", () => {
    // Scenario (§c3): two sessions overlapping in time must merge into one strictly
    // timestamp-ordered stream, each session's internal order preserved.
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
    // Scenario (§c3): a session's unstamped leading record (a file-history snapshot) must
    // stay glued in front of its session's first stamped record, not float to the stream head.
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
    // Scenario: one list under one root is the degenerate case — merge must return the same
    // records in the same order (dedupe, interleave, and join are all no-ops).
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
