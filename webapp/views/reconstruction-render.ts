// Partial-reconstruction DOM half (task 119): banner, gap rows, and per-file coverage segments; counting lives in reconstruction-coverage.ts.

import { createElement } from "../app-dom.ts";
import {
  type CoverageSegment,
  type TimelineGap,
  buildFileCoverageSegments,
  buildTimelineGaps,
  computeGapInsertionIndexes,
  computeReconstructionCoverage,
} from "./reconstruction-coverage.ts";
import type { TimelineNode } from "./timeline-node-types.ts";
import type { WireTimelineDocument } from "./timeline-wire-types.ts";

// Mount the ⚠ banner beside #timeline-summary when partial; a prior banner is removed first so re-renders never stack.
export function renderReconstructionBanner(reconstructionDocument: WireTimelineDocument): void {
  document.querySelector("#timeline-pane-header .recon-banner")?.remove();
  const coverage = computeReconstructionCoverage(reconstructionDocument);
  if (!coverage.isPartial) {
    return;
  }
  const skippedClause = coverage.skippedLineCount === 0 ? "" : ` · ${coverage.skippedLineCount} records skipped`;
  const failureReasons: string[] = [];
  for (const failure of reconstructionDocument.failures ?? []) {
    failureReasons.push(failure.reason);
  }
  const banner = createElement("div", {
    class: "recon-banner",
    title: failureReasons.join("\n"),
  }, [
    createElement("span", { class: "warn", text: "⚠ Partial reconstruction" }),
    ` — ${coverage.unrecoverableRevisions} of ${coverage.totalRevisions} revisions unrecoverable${skippedClause}`,
  ]);
  document.getElementById("timeline-summary")!.after(banner);
}

// Gap rows bucketed by the node index each renders before; bucket nodes.length means after the last row.
export function computeGapRowBuckets(reconstructionDocument: WireTimelineDocument, nodes: TimelineNode[]): Map<number, TimelineGap[]> {
  const gaps = buildTimelineGaps(reconstructionDocument.skippedLines ?? []);
  const nodeTimestamps: string[] = [];
  for (const node of nodes) {
    nodeTimestamps.push(node.when);
  }
  return computeGapInsertionIndexes(gaps, nodeTimestamps);
}

// One dashed .tl-gap-row per gap in a bucket (undefined bucket = no gaps at this index).
export function appendGapRows(rowFragment: DocumentFragment, gaps: TimelineGap[] | undefined): void {
  for (const gap of gaps ?? []) {
    rowFragment.append(createElement("div", {
      class: "tl-row tl-gap-row",
      text: `✗ ${gap.count} record(s) skipped — ${gap.reason}; revisions in this span unrecoverable`,
    }));
  }
}

// Coverage segments per target, only for files with an unrecovered revision; recovered files keep their plain row.
export function buildCoverageSegmentsByTarget(reconstructionDocument: WireTimelineDocument): Map<string, CoverageSegment[]> {
  const segmentsByTarget = new Map<string, CoverageSegment[]>();
  for (const history of reconstructionDocument.filesTouched) {
    const segments = buildFileCoverageSegments(history);
    let hasUnrecoveredSegment = false;
    for (const segment of segments) {
      if (!segment.recovered) {
        hasUnrecoveredSegment = true;
      }
    }
    if (hasUnrecoveredSegment) {
      segmentsByTarget.set(history.target, segments);
    }
  }
  return segmentsByTarget;
}
