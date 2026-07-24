// Partial-reconstruction coverage view-model half (task 119): DOM-free helpers turning the
// wire document's unrecoverable revisions, skipped lines, and survived failures into the
// session banner's summary, the Files sidebar's per-file coverage strips, and the timeline's
// dashed gap rows (tests/reconstruction-coverage.test.ts). The DOM halves live in timeline.ts,
// sidebar.ts, and timeline-render-rows.ts.
// The banner's counts: every revision across filesTouched, how many are unrecoverable
// placeholders, plus the document's skipped-line and survived-failure tallies. The optional
// wire fields default to empty (older cached documents predate them). Partial = any of the
// three failure counts is non-zero.
export function summarizeReconstructionCoverage(document) {
    const revisions = document.filesTouched.flatMap((history) => history.revisions);
    const unrecoverableRevisions = revisions.filter((revision) => revision.unrecoverable !== undefined).length;
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
// One strip segment per revision, in revision order; an unrecovered segment carries its reason
// for the strip's click-for-reason popover.
export function buildFileCoverageSegments(history) {
    return history.revisions.map((revision, index) => ({
        recovered: revision.unrecoverable === undefined,
        reason: revision.unrecoverable?.reason,
        revisionIndex: index,
    }));
}
// Whether a skipped line continues the run it follows: same transcript file, very next line
// number. Anything else starts a new run (and so a new gap row).
function checkLineExtendsRun(run, line) {
    if (run === undefined) {
        return false;
    }
    const previous = run[run.length - 1];
    if (previous.filePath !== line.filePath) {
        return false;
    }
    return previous.lineNumber + 1 === line.lineNumber;
}
// One gap from one run: count is the run length, reason the first line's, timestamp the run's
// first defined one, hydrated from its wire string.
function buildGapFromRun(run) {
    const rawTimestamp = run.find((line) => line.timestamp !== undefined)?.timestamp;
    return {
        count: run.length,
        reason: run[0].reason,
        timestamp: rawTimestamp === undefined ? undefined : new Date(rawTimestamp),
    };
}
// Group the skipped lines into gap rows: a contiguous run (one filePath, consecutive
// lineNumbers) becomes ONE gap, in input order.
export function buildTimelineGaps(skippedLines) {
    const runs = [];
    for (const line of skippedLines) {
        const currentRun = runs[runs.length - 1];
        if (checkLineExtendsRun(currentRun, line)) {
            currentRun.push(line);
            continue;
        }
        runs.push([line]);
    }
    return runs.map(buildGapFromRun);
}
// The node index one gap renders before: the first node whose timestamp is at or after the
// gap's. A timestampless gap keys to 0 (nothing can place it later); a gap after every node
// keys to nodeTimestamps.length (the row loop appends it after the last node).
function findGapInsertionIndex(gap, nodeTimestamps) {
    if (gap.timestamp === undefined) {
        return 0;
    }
    const gapTime = gap.timestamp.getTime();
    const index = nodeTimestamps.findIndex((when) => new Date(when).getTime() >= gapTime);
    if (index < 0) {
        return nodeTimestamps.length;
    }
    return index;
}
// Bucket the gaps by the node index each renders before, preserving gap order per bucket.
export function computeGapInsertionIndexes(gaps, nodeTimestamps) {
    const gapsByNodeIndex = new Map();
    for (const gap of gaps) {
        const index = findGapInsertionIndex(gap, nodeTimestamps);
        const bucket = gapsByNodeIndex.get(index) ?? [];
        bucket.push(gap);
        gapsByNodeIndex.set(index, bucket);
    }
    return gapsByNodeIndex;
}
