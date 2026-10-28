// Timeline row build loop behind the progress overlay; per-row builder is timeline-render-row.ts.

import { hideLoadingProgress, showLoadingProgress } from "../app-progress.ts";
import { findSessionStartIndexes } from "./timeline-labels-pills.ts";
import { appendGapRows, computeGapRowBuckets } from "./reconstruction-render.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { buildTimelineRow } from "./timeline-render-row.ts";
import { appendSessionStartMarker } from "./timeline-render-row-cells.ts";
import {
  computeTimelineBuildProgressLabel,
  computeTimelineProgressFraction,
  isTimelineNeedingProgressOverlay,
  TIMELINE_BUILD_BATCH_SIZE,
  waitForNextAnimationFrame,
} from "./timeline-build-progress.ts";
import { ORPHAN_LANE_COLOR } from "./timeline-sessions.ts";

export async function buildTimelineRows(context: TimelineRenderContext, container: HTMLElement): Promise<void> {
  // Session-start markers show where a later session began in interleaved projects.
  const sessionStartsByIndex = new Map<number, string>();
  for (const start of findSessionStartIndexes(context.nodes)) {
    sessionStartsByIndex.set(start.nodeIndex, start.sessionId);
  }
  // Dashed gap rows for skipped transcript lines, keyed by the node index they precede.
  const gapRowBuckets = computeGapRowBuckets(context.reconstructionDocument, context.nodes);
  // Large timelines build in yielding batches behind an overlay; rows stay detached until done.
  const showBuildProgress = isTimelineNeedingProgressOverlay(context.nodes.length);
  const rowFragment = document.createDocumentFragment();
  if (showBuildProgress) {
    showLoadingProgress(computeTimelineBuildProgressLabel(0, context.nodes.length), computeTimelineProgressFraction(0, context.nodes.length));
    await waitForNextAnimationFrame();
  }
  try {
    for (const [index, node] of context.nodes.entries()) {
      const sessionColor = node.sessionId === undefined
        ? ORPHAN_LANE_COLOR
        : context.sessionColors.get(node.sessionId) ?? ORPHAN_LANE_COLOR;
      appendGapRows(rowFragment, gapRowBuckets.get(index));
      const startedSessionId = sessionStartsByIndex.get(index);
      if (startedSessionId !== undefined) {
        appendSessionStartMarker(context, rowFragment, sessionColor, startedSessionId);
      }
      rowFragment.append(buildTimelineRow(context, node, index, sessionColor));
      const isBatchEnd = (index + 1) % TIMELINE_BUILD_BATCH_SIZE === 0;
      const shouldYield = showBuildProgress && isBatchEnd;
      if (shouldYield) {
        showLoadingProgress(computeTimelineBuildProgressLabel(index + 1, context.nodes.length), computeTimelineProgressFraction(index + 1, context.nodes.length));
        await waitForNextAnimationFrame();
      }
    }
    appendGapRows(rowFragment, gapRowBuckets.get(context.nodes.length));
    container.append(rowFragment);
  }
  finally {
    hideLoadingProgress();
  }
}
