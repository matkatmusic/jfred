// Build-progress overlay thresholds, labels, and fractions (split from timeline-sessions.ts).

// Exported so the boundary tests track this tuned-in-place value instead of hardcoding it.
export const LARGE_TIMELINE_ROW_COUNT = 100;

// Rows built per animation frame during a chunked (large-timeline) build.
export const TIMELINE_BUILD_BATCH_SIZE = 10;

export function isTimelineNeedingProgressOverlay(rowCount: number): boolean {
  return rowCount >= LARGE_TIMELINE_ROW_COUNT;
}

export function computeTimelineBuildProgressLabel(rowsBuilt: number, totalRows: number): string {
  return `Building timeline… ${rowsBuilt} / ${totalRows} rows`;
}

// A zero total counts as fully built so an empty build never divides by zero.
export function computeTimelineProgressFraction(rowsBuilt: number, totalRows: number): number {
  if (totalRows === 0) {
    return 1;
  }
  return rowsBuilt / totalRows;
}

function scheduleFrameResolve(resolve: () => void): void {
  function stopWaiting(): void {
    resolve();
  }
  requestAnimationFrame(stopWaiting);
}

// Resolve next frame so a DOM update paints before the next row batch blocks the thread (item 78).
export function waitForNextAnimationFrame(): Promise<void> {
  return new Promise(scheduleFrameResolve);
}
