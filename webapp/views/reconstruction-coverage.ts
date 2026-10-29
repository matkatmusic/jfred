// DOM-free coverage helpers: banner summary, per-file coverage strips, and timeline gap rows.

import type { WireFileHistory, WireTimelineDocument } from "./timeline-wire-types.ts";

// One line the tolerant parse skipped, as it arrives on the wire (timestamp still a string).
type WireSkippedLine = NonNullable<WireTimelineDocument["skippedLines"]>[number];

// Coverage summary for the session banner.
export type CoverageSummary = {
  totalRevisions: number;
  unrecoverableRevisions: number;
  skippedLineCount: number;
  failureCount: number;
  isPartial: boolean;
};

// One segment of a file's coverage strip: one revision, recovered or not.
export type CoverageSegment = { recovered: boolean; reason?: string; revisionIndex: number };

// One dashed gap row for the timeline: a contiguous run of skipped lines from one file.
export type TimelineGap = { count: number; reason: string; timestamp?: Date };

// The banner's counts: revisions, unrecoverable placeholders, skipped lines, and survived failures; partial means any is non-zero.
export function computeReconstructionCoverage(document: WireTimelineDocument): CoverageSummary {
  const revisions = [];
  for (const history of document.filesTouched) {
    revisions.push(...history.revisions);
  }
  let unrecoverableRevisions = 0;
  for (const revision of revisions) {
    if (revision.unrecoverable !== undefined) {
      unrecoverableRevisions += 1;
    }
  }
  const skippedLineCount = (document.skippedLines ?? []).length;
  const failureCount = (document.failures ?? []).length;
  return {
    totalRevisions: revisions.length,
    unrecoverableRevisions,
    skippedLineCount,
    failureCount,
    isPartial: unrecoverableRevisions + skippedLineCount + failureCount > 0,
  };
}

// One strip segment per revision, in revision order; an unrecovered segment carries its reason for the strip's click-for-reason popover.
export function buildFileCoverageSegments(history: WireFileHistory): CoverageSegment[] {
  const segments: CoverageSegment[] = [];
  for (const [index, revision] of history.revisions.entries()) {
    segments.push({
      recovered: revision.unrecoverable === undefined,
      reason: revision.unrecoverable?.reason,
      revisionIndex: index,
    });
  }
  return segments;
}

// Whether a skipped line continues the previous run: same file, next line number.
function isLineExtendingRun(run: WireSkippedLine[] | undefined, line: WireSkippedLine): boolean {
  if (run === undefined) {
    return false;
  }
  const previous = run[run.length - 1]!;
  if (previous.filePath !== line.filePath) {
    return false;
  }
  return previous.lineNumber + 1 === line.lineNumber;
}

// One gap from one run: run length, first reason, and the first defined timestamp as a Date.
function buildGapFromRun(run: WireSkippedLine[]): TimelineGap {
  let rawTimestamp: string | undefined;
  for (const line of run) {
    if (line.timestamp !== undefined) {
      rawTimestamp = line.timestamp;
      break;
    }
  }
  return {
    count: run.length,
    reason: run[0]!.reason,
    timestamp: rawTimestamp === undefined ? undefined : new Date(rawTimestamp),
  };
}

// Group skipped lines into gap rows: each contiguous run becomes one gap, in input order.
export function buildTimelineGaps(skippedLines: WireSkippedLine[]): TimelineGap[] {
  const runs: WireSkippedLine[][] = [];
  for (const line of skippedLines) {
    const currentRun = runs[runs.length - 1];
    const extendsRun = isLineExtendingRun(currentRun, line);
    if (extendsRun) {
      currentRun!.push(line);
      continue;
    }
    runs.push([line]);
  }
  const gaps: TimelineGap[] = [];
  for (const run of runs) {
    gaps.push(buildGapFromRun(run));
  }
  return gaps;
}

// The node index a gap renders before; a timestampless gap keys to 0, a trailing gap to the length.
function findGapInsertionIndex(gap: TimelineGap, nodeTimestamps: string[]): number {
  if (gap.timestamp === undefined) {
    return 0;
  }
  const gapTime = gap.timestamp.getTime();
  for (const [index, when] of nodeTimestamps.entries()) {
    const nodeTime = new Date(when).getTime();
    if (nodeTime >= gapTime) {
      return index;
    }
  }
  return nodeTimestamps.length;
}

// Bucket the gaps by the node index each renders before, preserving gap order per bucket.
export function computeGapInsertionIndexes(gaps: TimelineGap[], nodeTimestamps: string[]): Map<number, TimelineGap[]> {
  const gapsByNodeIndex = new Map<number, TimelineGap[]>();
  for (const gap of gaps) {
    const index = findGapInsertionIndex(gap, nodeTimestamps);
    const bucket = gapsByNodeIndex.get(index) ?? [];
    bucket.push(gap);
    gapsByNodeIndex.set(index, bucket);
  }
  return gapsByNodeIndex;
}
