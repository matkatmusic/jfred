// Spec S5 (task 176) §c4 conflict notes: a cross-source contradiction on a JOINED file must not abort — it surfaces as a task-119 health-sink conflict note while the merged timeline still completes; an agreeing cross-source stream stays silent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { reconstructFile } from "../src/reconstruction_engine.ts";
import { mergeMultiSourceRecords } from "../src/reconstruction_multi_source.ts";
import { clearReconstructionFailures, drainReconstructionFailures } from "../src/reconstruction_health.ts";
import {
    makeTwoSourceEditFixture,
    buildEditRecordPair,
    SESSION_A,
    type WireHunk,
} from "./multi-source-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

// A's second edit at 10:10 with the given post-content, pre-edit evidence, and hunk.
function buildSecondEditOfA(
    locations: { rootA: string; alphaPath: string },
    postContent: string,
    originalFile: string,
    hunk: WireHunk,
): object[] {
    const envelope = {
        sessionId: SESSION_A,
        cwd: locations.rootA,
        timestamp: "2026-07-22T10:10:00.000Z",
        toolId: "toolu_edit_a2",
        parentUuid: "toolu_write_a1-result",
    };
    return buildEditRecordPair(envelope, locations.alphaPath, postContent, originalFile, hunk).records;
}

test("test_cross_source_contradiction_emits_conflict_note_and_completes_timeline", () => {
    // Scenario (§c4): A writes at t1, B's t2 edit agrees (join fires), then A's t3 edit carries pre-state evidence that contradicts the merged state at t3 (it never saw B's line).  Steps: A write "line one" t1 → B edit +"line two" t2 → A edit t3, originalFile still "line one" (stale — the contradiction).
    const fixture = makeTwoSourceEditFixture("line one\n", (locations) =>
        buildSecondEditOfA(locations, "line one\nline three\n", "line one\n", {
            oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line three"],
        }));
    clearReconstructionFailures();
    const merged = mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    // Test verification 1: exactly one conflict note, targeting the joined primary path.
    const conflicts = drainReconstructionFailures().filter((failure) => failure.stage === "noteJoinedPathConflicts");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.target?.toString(), fixture.alphaPath);
    assert.match(conflicts[0]!.reason, /cross-source conflict/);
    // Test verification 2: the timeline is still COMPLETE — all three revisions present.
    const revisions = reconstructFile(merged, new Path(fixture.alphaPath));
    assert.equal(revisions.length, 3);
});

test("test_agreeing_cross_source_stream_emits_no_conflict_note", () => {
    // Scenario: the same alternating stream but A's t3 evidence saw B's line — no contradiction,
    // so the conflict path must stay silent.
    const fixture = makeTwoSourceEditFixture("line one\n", (locations) =>
        buildSecondEditOfA(locations, "line one\nline two\nline three\n", "line one\nline two\n", {
            oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" line one", " line two", "+line three"],
        }));
    clearReconstructionFailures();
    mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    const conflicts = drainReconstructionFailures().filter((failure) => failure.stage === "noteJoinedPathConflicts");
    assert.equal(conflicts.length, 0);
});
