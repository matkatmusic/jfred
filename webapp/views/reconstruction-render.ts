// Partial-reconstruction DOM half (task 119): the pane-header banner, the timeline's dashed gap rows, and the per-file coverage-segment map the Files sidebar's strips render from.  The DOM-free counting/grouping lives in reconstruction-coverage.ts; this render half is untested by the project's dual-renderer convention. Split out of timeline.ts / timeline-render-rows.ts, both of which sit at the 250-line cap.

import { el } from "../app-dom.ts";
import {
    type CoverageSegment,
    type TimelineGap,
    buildFileCoverageSegments,
    buildTimelineGaps,
    computeGapInsertionIndexes,
    summarizeReconstructionCoverage,
} from "./reconstruction-coverage.ts";
import type { TimelineNode, WireTimelineDocument } from "./timeline-types.ts";

// Mount the ⚠ banner beside #timeline-summary when the document is partial; any prior banner is removed first so re-renders never stack (and a clean re-render leaves none). The native title tooltip carries the full failure reasons, one per line — no "show gaps" popover: the gap rows and coverage strips already show every gap in place.
export function renderReconstructionBanner(reconstructionDocument: WireTimelineDocument): void {
    document.querySelector("#timeline-pane-header .recon-banner")?.remove();
    const coverage = summarizeReconstructionCoverage(reconstructionDocument);
    if (!coverage.isPartial) {
        return;
    }
    const skippedClause = coverage.skippedLineCount === 0 ? "" : ` · ${coverage.skippedLineCount} records skipped`;
    const banner = el("div", {
        class: "recon-banner",
        title: (reconstructionDocument.failures ?? []).map((failure) => failure.reason).join("\n"),
    }, [
        el("span", { class: "warn", text: "⚠ Partial reconstruction" }),
        ` — ${coverage.unrecoverableRevisions} of ${coverage.totalRevisions} revisions unrecoverable${skippedClause}`,
    ]);
    document.getElementById("timeline-summary")!.after(banner);
}

// The timeline's gap rows bucketed by the node index each renders before (bucket nodes.length = after the last row); computed once per buildTimelineRows pass.
export function computeGapRowBuckets(reconstructionDocument: WireTimelineDocument, nodes: TimelineNode[]): Map<number, TimelineGap[]> {
    const gaps = buildTimelineGaps(reconstructionDocument.skippedLines ?? []);
    return computeGapInsertionIndexes(gaps, nodes.map((node) => node.when));
}

// One dashed .tl-gap-row per gap in a bucket (undefined bucket = no gaps at this index).
export function appendGapRows(rowFragment: DocumentFragment, gaps: TimelineGap[] | undefined): void {
    for (const gap of gaps ?? []) {
        rowFragment.append(el("div", {
            class: "tl-row tl-gap-row",
            text: `✗ ${gap.count} record(s) skipped — ${gap.reason}; revisions in this span unrecoverable`,
        }));
    }
}

// The Files sidebar's strip input: coverage segments per target, ONLY for files with at least one unrecovered revision — fully recovered files keep their plain row (real files can have 100+ revisions; a strip on every row is noise).
export function buildCoverageSegmentsByTarget(reconstructionDocument: WireTimelineDocument): Map<string, CoverageSegment[]> {
    const entries = reconstructionDocument.filesTouched
        .map((history) => [history.target, buildFileCoverageSegments(history)] as const)
        .filter(([, segments]) => segments.some((segment) => !segment.recovered));
    return new Map(entries);
}
