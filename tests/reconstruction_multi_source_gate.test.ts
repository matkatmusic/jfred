// Task 176 §c4: a cross-source contradiction on a joined file emits a conflict note, never aborts.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { EditEvent } from "../src/reconstruction_events.ts";
import { isEditEvidenceMatchingState } from "../src/reconstruction_multi_source_gate.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { buildFileRevisions } from "../src/reconstruction_engine.ts";
import { mergeMultiSourceRecords } from "../src/reconstruction_multi_source.ts";
import { clearReconstructionFailures, popReconstructionFailures } from "../src/reconstruction_health.ts";
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
    // A writes t1, B edits t2 (join), then A's t3 edit has stale originalFile that contradicts the merge.
    const fixture = makeTwoSourceEditFixture("line one\n", (locations) =>
        buildSecondEditOfA(locations, "line one\nline three\n", "line one\n", {
            oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line three"],
        }));
    clearReconstructionFailures();
    const merged = mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    // Test verification 1: exactly one conflict note, targeting the joined primary path.
    const conflicts = popReconstructionFailures().filter((failure) => failure.stage === "noteJoinedPathConflicts");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.target?.toString(), fixture.alphaPath);
    assert.match(conflicts[0]!.reason, /cross-source conflict/);
    // Test verification 2: the timeline is still COMPLETE — all three revisions present.
    const revisions = buildFileRevisions(merged, new Path(fixture.alphaPath));
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
    const conflicts = popReconstructionFailures().filter((failure) => failure.stage === "noteJoinedPathConflicts");
    assert.equal(conflicts.length, 0);
});

function buildEditEventWithNullOriginalFile(): EditEvent {
    return {
        kind: EventKind.edit,
        changeId: new Uuid("toolu_null_original"),
        target: new Path("/tmp/alpha.txt"),
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] }],
        originalFile: null,
        timestamp: new Date("2026-07-22T10:10:00.000Z"),
    };
}

test("test_edit_with_null_original_file_falls_through_to_hunk_pre_side_check", () => {
    const edit = buildEditEventWithNullOriginalFile();
    assert.equal(isEditEvidenceMatchingState(edit, "line one"), true);
    assert.equal(isEditEvidenceMatchingState(edit, "other text"), false);
});
