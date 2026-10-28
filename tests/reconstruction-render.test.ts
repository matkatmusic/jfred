// DOM tests for the partial-reconstruction render half: banner, gap rows, and coverage-segment map.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendGapRows,
    buildCoverageSegmentsByTarget,
    computeGapRowBuckets,
    renderReconstructionBanner,
} from "../webapp/views/reconstruction-render.ts";
import { COMMIT_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { TimelineNode } from "../webapp/views/timeline-node-types.ts";
import type { WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

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

function makeRevision(changeId: string, unrecoverable?: { reason: string }) {
    return { kind: EventKind.write as string, changeId, timestamp: "2026-07-01T10:00:00Z", unrecoverable };
}

function makeCommitNode(when: string): TimelineNode {
    return { kind: COMMIT_NODE_KIND, when, sessionId: undefined };
}

function openBannerPage(): void {
    initLayer1Dom();
    document.body.innerHTML = '<div id="timeline-pane-header"><div id="timeline-summary"></div></div>';
}

const PARTIAL_DOCUMENT = buildWireDocument({
    filesTouched: [
        { target: "/p/a.py", revisions: [makeRevision("A1"), makeRevision("A2", { reason: "backup missing" })] },
        { target: "/p/b.py", revisions: [makeRevision("B1")] },
    ],
    skippedLines: [{ filePath: "/p/s.jsonl", lineNumber: 7, reason: "unknown record type", timestamp: "2026-07-01T10:00:00Z" }],
    failures: [
        { scope: "file-stage", stage: "fillRedirectContent", target: "/p/a.py", reason: "first failure" },
        { scope: "file-stage", stage: "fillRedirectContent", target: "/p/a.py", reason: "second failure" },
    ],
});

test("test_renderReconstructionBanner_mounts_banner_for_partial_document", () => {
    openBannerPage();
    renderReconstructionBanner(PARTIAL_DOCUMENT);
    const banner = document.querySelector("#timeline-pane-header .recon-banner")!;
    assert.equal(banner.getAttribute("title"), "first failure\nsecond failure");
    assert.equal(banner.textContent, "⚠ Partial reconstruction — 1 of 3 revisions unrecoverable · 1 records skipped");
});

test("test_renderReconstructionBanner_replaces_prior_banner_and_leaves_none_when_clean", () => {
    openBannerPage();
    renderReconstructionBanner(PARTIAL_DOCUMENT);
    renderReconstructionBanner(PARTIAL_DOCUMENT);
    assert.equal(document.querySelectorAll(".recon-banner").length, 1);
    renderReconstructionBanner(buildWireDocument({}));
    assert.equal(document.querySelectorAll(".recon-banner").length, 0);
});

test("test_computeGapRowBuckets_buckets_gap_before_first_later_node", () => {
    initLayer1Dom();
    const nodes = [makeCommitNode("2026-07-01T09:00:00Z"), makeCommitNode("2026-07-01T11:00:00Z")];
    const buckets = computeGapRowBuckets(PARTIAL_DOCUMENT, nodes);
    assert.deepEqual([...buckets.keys()], [1]);
    assert.equal(buckets.get(1)![0]!.count, 1);
});

test("test_appendGapRows_appends_one_row_per_gap_and_nothing_for_undefined", () => {
    initLayer1Dom();
    const fragment = document.createDocumentFragment();
    appendGapRows(fragment, undefined);
    assert.equal(fragment.childNodes.length, 0);
    appendGapRows(fragment, [{ count: 2, reason: "bad json" }]);
    assert.equal(fragment.childNodes.length, 1);
    assert.equal(
        (fragment.firstChild as HTMLElement).textContent,
        "✗ 2 record(s) skipped — bad json; revisions in this span unrecoverable",
    );
});

test("test_buildCoverageSegmentsByTarget_keeps_only_files_with_an_unrecovered_revision", () => {
    const segmentsByTarget = buildCoverageSegmentsByTarget(PARTIAL_DOCUMENT);
    assert.deepEqual([...segmentsByTarget.keys()], ["/p/a.py"]);
    assert.deepEqual(segmentsByTarget.get("/p/a.py"), [
        { recovered: true, reason: undefined, revisionIndex: 0 },
        { recovered: false, reason: "backup missing", revisionIndex: 1 },
    ]);
});
