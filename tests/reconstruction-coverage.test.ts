// View-model tests for the partial-reconstruction coverage helpers, using wire-shaped literal fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildFileCoverageSegments,
    buildTimelineGaps,
    computeGapInsertionIndexes,
    computeReconstructionCoverage,
    type TimelineGap,
} from "../webapp/views/reconstruction-coverage.ts";
import type { WireFileHistory, WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

// The wire document with only the coverage-relevant fields varying.
function buildWireDocument(overrides: Partial<WireTimelineDocument>): WireTimelineDocument {
    return {
        filesTouched: [],
        rewoundFilesTouched: [],
        messages: [],
        steps: [],
        commitMarkers: [],
        ...overrides,
    };
}

// One wire revision; unrecoverable is the engine's task-119 placeholder marker.
function makeRevision(changeId: string, unrecoverable?: { reason: string }) {
    return { kind: EventKind.write as string, changeId, timestamp: "2026-07-01T10:00:00Z", unrecoverable };
}

test("test_computeReconstructionCoverage_counts_unrecoverable_revisions", () => {
    // Step 1: three revisions with one placeholder, one skipped line, and one survived failure.
    const document = buildWireDocument({
        filesTouched: [
            { target: "/p/a.py", revisions: [makeRevision("toolu_A1"), makeRevision("toolu_A2", { reason: "sidecar backup missing" })] },
            { target: "/p/b.py", revisions: [makeRevision("toolu_B1")] },
        ],
        skippedLines: [{ filePath: "/p/s.jsonl", lineNumber: 7, reason: 'unknown record type "future-nonsense"' }],
        failures: [{ scope: "file-stage", stage: "fillRedirectContent", target: "/p/a.py", reason: "ENOENT: blob gone" }],
    });
    // Step 2: every count lands in the summary, and any non-zero count marks it partial.
    assert.deepEqual(computeReconstructionCoverage(document), {
        totalRevisions: 3,
        unrecoverableRevisions: 1,
        skippedLineCount: 1,
        failureCount: 1,
        isPartial: true,
    });
});

test("test_computeReconstructionCoverage_is_not_partial_for_clean_document", () => {
    // Step 1: a fully recovered document with no skippedLines or failures fields.
    const document = buildWireDocument({
        filesTouched: [{ target: "/p/a.py", revisions: [makeRevision("toolu_A1")] }],
    });
    // Step 2: all failure counts are zero, so the banner stays hidden.
    assert.deepEqual(computeReconstructionCoverage(document), {
        totalRevisions: 1,
        unrecoverableRevisions: 0,
        skippedLineCount: 0,
        failureCount: 0,
        isPartial: false,
    });
});

test("test_buildFileCoverageSegments_marks_unrecoverable_revisions", () => {
    // Step 1: a three-revision history whose middle revision is a placeholder.
    const history: WireFileHistory = {
        target: "/p/a.py",
        revisions: [
            makeRevision("toolu_A1"),
            makeRevision("toolu_A2", { reason: "sidecar backup missing" }),
            makeRevision("toolu_A3"),
        ],
    };
    // Step 2: one segment per revision; only the placeholder is unrecovered and carries its reason.
    assert.deepEqual(buildFileCoverageSegments(history), [
        { recovered: true, reason: undefined, revisionIndex: 0 },
        { recovered: false, reason: "sidecar backup missing", revisionIndex: 1 },
        { recovered: true, reason: undefined, revisionIndex: 2 },
    ]);
});

test("test_buildTimelineGaps_groups_consecutive_lines_into_one_gap", () => {
    // Step 1: three consecutive skipped lines; only the middle one has a parseable timestamp.
    const gaps = buildTimelineGaps([
        { filePath: "/p/s.jsonl", lineNumber: 5, reason: "malformed JSON: SyntaxError" },
        { filePath: "/p/s.jsonl", lineNumber: 6, timestamp: "2026-07-01T10:00:00Z", reason: 'unknown record type "future-nonsense"' },
        { filePath: "/p/s.jsonl", lineNumber: 7, reason: "malformed JSON: SyntaxError" },
    ]);
    // Step 2: one gap with the run length, the first reason, and the first timestamp as a Date.
    assert.deepEqual(gaps, [
        { count: 3, reason: "malformed JSON: SyntaxError", timestamp: new Date("2026-07-01T10:00:00Z") },
    ]);
});

test("test_buildTimelineGaps_splits_non_consecutive_lines", () => {
    // Step 1: a line-number jump and a file change each break the run.
    const gaps = buildTimelineGaps([
        { filePath: "/p/s.jsonl", lineNumber: 2, reason: "reason-a" },
        { filePath: "/p/s.jsonl", lineNumber: 5, reason: "reason-b" },
        { filePath: "/p/t.jsonl", lineNumber: 6, reason: "reason-c" },
    ]);
    // Step 2: three single-line gaps, one per run.
    assert.deepEqual(gaps, [
        { count: 1, reason: "reason-a", timestamp: undefined },
        { count: 1, reason: "reason-b", timestamp: undefined },
        { count: 1, reason: "reason-c", timestamp: undefined },
    ]);
});

test("test_computeGapInsertionIndexes_places_gap_before_first_later_node", () => {
    // Step 1: one gap between the first and second nodes, and one after every node.
    const between: TimelineGap = { count: 1, reason: "reason-a", timestamp: new Date("2026-07-01T10:30:00Z") };
    const trailing: TimelineGap = { count: 2, reason: "reason-b", timestamp: new Date("2026-07-01T13:00:00Z") };
    const indexes = computeGapInsertionIndexes(
        [between, trailing],
        ["2026-07-01T10:00:00Z", "2026-07-01T11:00:00Z", "2026-07-01T12:00:00Z"],
    );
    // Step 2: the between-gap keys to node 1; the trailing gap keys past the last node.
    assert.deepEqual(indexes, new Map([[1, [between]], [3, [trailing]]]));
});

test("test_computeGapInsertionIndexes_places_timestampless_gap_first", () => {
    // Step 1: a malformed-JSON gap carries no timestamp — nothing can place it later.
    const gap: TimelineGap = { count: 1, reason: "malformed JSON: SyntaxError", timestamp: undefined };
    // Step 2: it keys to index 0, rendering before the first node.
    assert.deepEqual(
        computeGapInsertionIndexes([gap], ["2026-07-01T10:00:00Z"]),
        new Map([[0, [gap]]]),
    );
});
